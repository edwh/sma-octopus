// ev-forecast.js — estimate the overnight battery top-up needed to pre-store the energy the
// EV will draw, from historical consumption in ev-samples.csv.
//
// The car charges ~every other day at ~3.7 kW and mostly in the morning, draining the home
// battery before solar can help (observed 2026-08: SOC emptied to 8% by 10:00, then grid at
// peak). This module estimates the expected daily EV energy and returns a % to ADD to the
// overnight Octopus Go charge target, so that energy is bought at 8.5p overnight instead of
// ~31p peak next morning.
//
// Design choices:
//  - Rolling average over the last N days across ALL days (not just charging days), so the
//    ~every-other-day frequency is baked in automatically - we provision the expected value.
//  - EV energy inferred from consumption: samples above EV_DETECT_W, with the per-sample EV
//    share capped at the car's ~3.7 kW rate so house spikes (oven/immersion) don't inflate it.
//    This is a rough inference, not metered EV (dumb charger, no API).
//  - SEASONAL monthly factor (like the SOC targets): low in summer (daytime solar cheaply
//    refills the battery after the morning draw) and high in winter (no solar recovery, so
//    pre-storing overnight at cheap rate matters most).
//  - Bounded and fail-safe: returns 0 on disable / missing data / any error, and is capped.

require('dotenv').config()
const fs = require('fs')
const path = require('path')

const CSV = path.join(__dirname, 'ev-samples.csv')
const ENABLED = process.env.OCTOPUS_GO_EV_TOPUP_ENABLED === 'true'
const WINDOW_DAYS = parseInt(process.env.EV_TOPUP_WINDOW_DAYS) || 14
const BASELINE_W = parseFloat(process.env.EV_BASELINE_W) || 700
const EV_RATE_W = parseFloat(process.env.EV_CHARGE_RATE_W) || 3700 // i3 ~single-phase 16A
const EV_DETECT_W = parseFloat(process.env.EV_DETECT_W) || 3000
const MAX_TOPUP_PCT = parseFloat(process.env.EV_TOPUP_MAX_PCT) || 40
// Seasonal scaling 0-100% per month (Jan..Dec). Tune to taste; winter-high, summer-low.
const SEASONAL_CSV = process.env.OCTOPUS_GO_EV_TOPUP_FACTOR || '100,90,80,60,40,30,30,40,60,80,90,100'

function debug(msg, data) {
  if (process.env.DEBUG === 'true') console.log(`[DEBUG ${new Date().toISOString()}] EV-FORECAST: ${msg}`, data !== undefined ? data : '')
}

// Estimate a single day's EV kWh from its samples (already time-sorted).
function dayEvKwh(rs) {
  let evk = 0
  for (let i = 0; i < rs.length; i++) {
    if (rs[i].cons > EV_DETECT_W) {
      // Interval to the next sample (h), capped at 1h so a data gap can't inflate the integral.
      let h = 0.5
      if (i + 1 < rs.length) h = Math.min(1, (rs[i + 1].t - rs[i].t) / 3600000)
      evk += Math.min(rs[i].cons - BASELINE_W, EV_RATE_W) / 1000 * h
    }
  }
  return evk
}

// Returns { topupPct, avgDailyKwh, seasonalFactor, days, reason }. topupPct is 0 when
// disabled / no data / error - callers add it to the target unconditionally.
exports.getEvTopupPercent = function (capacityKwh = 31.2) {
  if (!ENABLED) return { topupPct: 0, reason: 'disabled' }
  let rows
  try {
    rows = fs.readFileSync(CSV, 'utf8').trim().split('\n').slice(1)
      .map(l => l.split(','))
      .filter(c => c[1] !== undefined && c[1] !== '')
      .map(c => ({ t: Date.parse(c[0]), cons: parseFloat(c[1]) }))
      .filter(r => !Number.isNaN(r.t) && !Number.isNaN(r.cons))
  } catch (e) {
    debug('csv read failed', e.message)
    return { topupPct: 0, reason: 'no csv' }
  }

  const cutoff = Date.now() - WINDOW_DAYS * 86400000
  const byDay = {}
  for (const r of rows) {
    if (r.t < cutoff) continue
    const d = new Date(r.t).toISOString().slice(0, 10)
    ;(byDay[d] = byDay[d] || []).push(r)
  }
  const dayKeys = Object.keys(byDay)
  if (dayKeys.length === 0) return { topupPct: 0, reason: 'no recent data' }

  let sum = 0
  for (const d of dayKeys) {
    const rs = byDay[d].sort((a, b) => a.t - b.t)
    sum += dayEvKwh(rs)
  }
  const avgDailyKwh = sum / dayKeys.length // across ALL days -> frequency baked in

  const month = new Date().getMonth()
  const seasonalArr = SEASONAL_CSV.split(',').map(Number)
  const seasonalFactor = (Number.isFinite(seasonalArr[month]) ? seasonalArr[month] : 100) / 100

  const topupKwh = avgDailyKwh * seasonalFactor
  let topupPct = (topupKwh / capacityKwh) * 100
  topupPct = Math.max(0, Math.min(MAX_TOPUP_PCT, topupPct))

  debug('computed EV top-up', { avgDailyKwh: +avgDailyKwh.toFixed(2), seasonalFactor, topupKwh: +topupKwh.toFixed(2), topupPct: +topupPct.toFixed(1), days: dayKeys.length })
  return { topupPct, avgDailyKwh, seasonalFactor, topupKwh, days: dayKeys.length }
}
