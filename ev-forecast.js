// ev-forecast.js — estimate the overnight battery top-up needed to pre-store the energy the
// EV will draw next, from historical consumption in ev-samples.csv.
//
// The car charges at ~3.7 kW, mostly in the morning, draining the home battery before solar
// can help (observed 2026-08: SOC emptied to 8% by 10:00, then grid at peak). This module
// returns a % to ADD to the overnight Octopus Go charge target, so that energy is bought at
// 8.5p overnight instead of ~31p peak next morning.
//
// PREDICTION MODEL — state-based, not a fixed "every other day" (which drifts out of step):
//   expected_next = max(0, typical_full_charge − recent_actual_charge)
// i.e. if the car has NOT charged much recently it is probably low and will want a big charge
// soon → provision more; if it just charged a lot it is topped up → provision little. This
// tracks the car's actual state and self-corrects if the usual cadence breaks.
//   - typical_full_charge = mean EV kWh on days that DID charge (the "when it charges, ~this
//     much" reference), over the last WINDOW_DAYS.
//   - recent_actual_charge = EV kWh in the last LOOKBACK_H hours (i.e. "did it charge today").
//
// EV energy is inferred from consumption (samples > EV_DETECT_W, per-sample share capped at
// the car's ~3.7 kW rate so house spikes don't inflate it) — rough inference, not metered
// (dumb charger, no API). SEASONAL monthly factor (winter-high / summer-low: summer solar
// cheaply refills the battery after the draw). Bounded and fail-safe (0 on disable/no-data/error).

require('dotenv').config()
const fs = require('fs')
const path = require('path')

const CSV = path.join(__dirname, 'ev-samples.csv')
const ENABLED = process.env.OCTOPUS_GO_EV_TOPUP_ENABLED === 'true'
const WINDOW_DAYS = parseInt(process.env.EV_TOPUP_WINDOW_DAYS) || 14
const LOOKBACK_H = parseFloat(process.env.EV_TOPUP_LOOKBACK_H) || 24 // "did it charge today"
const SIGNIFICANT_KWH = parseFloat(process.env.EV_SIGNIFICANT_KWH) || 3 // a day counts as "charged"
const BASELINE_W = parseFloat(process.env.EV_BASELINE_W) || 700
const EV_RATE_W = parseFloat(process.env.EV_CHARGE_RATE_W) || 3700 // i3 ~single-phase 16A
const EV_DETECT_W = parseFloat(process.env.EV_DETECT_W) || 3000
const MAX_TOPUP_PCT = parseFloat(process.env.EV_TOPUP_MAX_PCT) || 40
// Seasonal scaling 0-100% per month (Jan..Dec). Tune to taste; winter-high, summer-low.
const SEASONAL_CSV = process.env.OCTOPUS_GO_EV_TOPUP_FACTOR || '100,90,80,60,40,30,30,40,60,80,90,100'

function debug(msg, data) {
  if (process.env.DEBUG === 'true') console.log(`[DEBUG ${new Date().toISOString()}] EV-FORECAST: ${msg}`, data !== undefined ? data : '')
}

// EV kWh from a time-sorted list of samples.
function evKwh(rs) {
  let k = 0
  for (let i = 0; i < rs.length; i++) {
    if (rs[i].cons > EV_DETECT_W) {
      // Interval to the next sample (h), capped at 1h so a data gap can't inflate the integral.
      let h = 0.5
      if (i + 1 < rs.length) h = Math.min(1, (rs[i + 1].t - rs[i].t) / 3600000)
      k += Math.min(rs[i].cons - BASELINE_W, EV_RATE_W) / 1000 * h
    }
  }
  return k
}

// Returns { topupPct, typicalKwh, recentKwh, expectedKwh, seasonalFactor, chargingDays, reason }.
// topupPct is 0 when disabled / no data / error - callers add it to the target unconditionally.
exports.getEvTopupPercent = function (capacityKwh = 31.2) {
  if (!ENABLED) return { topupPct: 0, reason: 'disabled' }
  let rows
  try {
    rows = fs.readFileSync(CSV, 'utf8').trim().split('\n').slice(1)
      .map(l => l.split(','))
      .filter(c => c[1] !== undefined && c[1] !== '')
      .map(c => ({ t: Date.parse(c[0]), cons: parseFloat(c[1]) }))
      .filter(r => !Number.isNaN(r.t) && !Number.isNaN(r.cons))
      .sort((a, b) => a.t - b.t)
  } catch (e) {
    debug('csv read failed', e.message)
    return { topupPct: 0, reason: 'no csv' }
  }
  if (rows.length === 0) return { topupPct: 0, reason: 'no data' }

  // typical_full_charge: mean EV kWh over days that actually charged (>= SIGNIFICANT_KWH),
  // within the WINDOW_DAYS history.
  const cutoff = Date.now() - WINDOW_DAYS * 86400000
  const byDay = {}
  for (const r of rows) {
    if (r.t < cutoff) continue
    const d = new Date(r.t).toISOString().slice(0, 10)
    ;(byDay[d] = byDay[d] || []).push(r)
  }
  const dailyKwh = Object.values(byDay).map(evKwh)
  const chargingDayKwh = dailyKwh.filter(k => k >= SIGNIFICANT_KWH)
  if (chargingDayKwh.length === 0) return { topupPct: 0, reason: 'no charging days in window' }
  const typicalKwh = chargingDayKwh.reduce((a, b) => a + b, 0) / chargingDayKwh.length

  // recent_actual_charge: EV kWh in the last LOOKBACK_H hours ("did it charge today").
  const recentCut = Date.now() - LOOKBACK_H * 3600000
  const recentKwh = evKwh(rows.filter(r => r.t >= recentCut))

  // The core prediction: shortfall from a typical full charge.
  const expectedKwh = Math.max(0, typicalKwh - recentKwh)

  const month = new Date().getMonth()
  const seasonalArr = SEASONAL_CSV.split(',').map(Number)
  const seasonalFactor = (Number.isFinite(seasonalArr[month]) ? seasonalArr[month] : 100) / 100

  const topupKwh = expectedKwh * seasonalFactor
  let topupPct = (topupKwh / capacityKwh) * 100
  topupPct = Math.max(0, Math.min(MAX_TOPUP_PCT, topupPct))

  debug('computed EV top-up', { typicalKwh: +typicalKwh.toFixed(2), recentKwh: +recentKwh.toFixed(2), expectedKwh: +expectedKwh.toFixed(2), seasonalFactor, topupPct: +topupPct.toFixed(1), chargingDays: chargingDayKwh.length })
  return { topupPct, typicalKwh, recentKwh, expectedKwh, seasonalFactor, topupKwh, chargingDays: chargingDayKwh.length }
}
