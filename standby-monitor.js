// standby-monitor.js — detect the inverter being unreachable / not reporting (e.g. after a
// power cut it can drop into standby) and alert, rate-limited to at most once every 4 hours.
//
// API-BASED (no browser). Signal: EnnexosApi.getData() either throws or returns no live
// state-of-charge. Two consecutive such checks (~30 min apart) are required before the first
// alert, so a one-off network blip doesn't page you. A one-off "recovered" email is sent when
// live data returns.
//
// NOTE: this detects "the inverter isn't reporting live data", which is the practical
// post-power-cut symptom. It can't yet distinguish a genuine inverter standby from an SMA
// API / network outage - both mean "no live data". If we capture the exact API response
// during a real standby we can tighten the signal.
//
// Test hook: STANDBY_TEST_REPORTING=false|true injects the probe result (skips the API).

require('dotenv').config()
const Api = require('./ennexosApi.js')
const Email = require('./email.js')
const fs = require('fs')
const path = require('path')

const STATE_FILE = path.join(__dirname, 'standby-state.json')
const CONSECUTIVE_THRESHOLD = 2
const ALERT_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (e) {
    return { consecutiveDown: 0, inStandby: false, lastAlertISO: null, firstDetectedISO: null, lastCheckISO: null }
  }
}
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)) }

// Returns { reporting: bool, detail } — reporting=false means the inverter isn't returning
// live data (possible standby / offline).
async function probeReporting() {
  if (process.env.STANDBY_TEST_REPORTING === 'true') return { reporting: true, detail: 'test' }
  if (process.env.STANDBY_TEST_REPORTING === 'false') return { reporting: false, detail: 'test' }
  try {
    const d = await Api.getData()
    if (d && d.stateOfCharge !== null && d.stateOfCharge !== undefined) {
      return { reporting: true, detail: `SOC=${d.stateOfCharge}` }
    }
    return { reporting: false, detail: 'API returned no state-of-charge' }
  } catch (e) {
    return { reporting: false, detail: e.message }
  }
}

async function main() {
  const nowISO = new Date().toISOString()
  const nowMs = Date.parse(nowISO)
  const state = loadState()
  state.lastCheckISO = nowISO

  const { reporting, detail } = await probeReporting()
  console.log(`[standby-monitor ${nowISO}] inverter reporting=${reporting} (${detail})`)

  if (reporting) {
    if (state.inStandby) {
      console.log('✅ Inverter reporting again - sending recovery email')
      await Email.sendErrorEmail(
        '✅ SMA inverter back online',
        `The inverter is reporting live data again (${detail}), so it has recovered from the standby/offline state.`,
        { recoveredAt: nowISO, wasFirstDetected: state.firstDetectedISO }
      )
    }
    saveState({ consecutiveDown: 0, inStandby: false, lastAlertISO: null, firstDetectedISO: null, lastCheckISO: nowISO })
    console.log('Inverter reporting normally - not in standby')
    return
  }

  // Not reporting -> count it.
  state.consecutiveDown = (state.consecutiveDown || 0) + 1
  if (!state.firstDetectedISO) state.firstDetectedISO = nowISO
  console.log(`   inverter not reporting ${state.consecutiveDown}/${CONSECUTIVE_THRESHOLD} (${detail})`)

  if (state.consecutiveDown >= CONSECUTIVE_THRESHOLD) {
    state.inStandby = true
    const dueForAlert = !state.lastAlertISO || (nowMs - Date.parse(state.lastAlertISO)) >= ALERT_INTERVAL_MS
    if (dueForAlert) {
      console.log('🚨 Sending inverter-standby alert email')
      await Email.sendErrorEmail(
        '⚠️ SMA inverter not reporting (possible standby)',
        'The inverter has not returned live data for two consecutive checks. After a power cut it can drop into standby and stop '
        + 'generating/charging until manually restarted; this can also be an SMA API or network outage. Charging control may be '
        + 'unavailable until it recovers.',
        { firstDetected: state.firstDetectedISO, consecutiveDown: state.consecutiveDown, lastDetail: detail }
      )
      state.lastAlertISO = nowISO
    } else {
      const mins = Math.round((ALERT_INTERVAL_MS - (nowMs - Date.parse(state.lastAlertISO))) / 60000)
      console.log(`Not reporting but within 4h rate-limit - next alert in ~${mins} min`)
    }
  } else {
    console.log('Not reporting once - waiting for a second consecutive check before alerting')
  }

  saveState(state)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[standby-monitor] fatal:', err); process.exit(1) })
