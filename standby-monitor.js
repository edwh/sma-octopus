// standby-monitor.js — detect the inverter dropping into standby (e.g. after a power
// cut) and alert, rate-limited to at most once every 4 hours.
//
// Primary signal (per observed behaviour): when the inverter is in standby, Sunny Portal
// will NOT open the battery-charge editor, so tests/checkChargeEditor.test.js reports
// CHARGE_EDITOR_REACHABLE: false. That is also the functionally meaningful condition —
// if the editor is unreachable we cannot control charging regardless of the root cause.
//
// False-alarm guards (both required before the first alert):
//   1. Two consecutive detections (~30 min apart) — a one-off slow load won't page you.
//   2. Corroboration from live data: battery flow zero/absent OR SOC unchanged since the
//      last check. If the editor is momentarily unreachable while the battery is actively
//      charging/discharging, the inverter is clearly NOT in standby, so we don't alert.
//
// On recovery (editor reachable again) it sends a one-off "recovered" email and resets.
//
// Read-only: the probe never saves; this script only reads inverter data and writes its
// own state file.
//
// Testing hooks (bypass the ~5 min Playwright probe / portal for state-machine tests):
//   STANDBY_TEST_REACHABLE=true|false   inject the editor-reachable result
//   STANDBY_TEST_BATT=<W|null>          inject batteryCharging (corroboration)
//   STANDBY_TEST_SOC=<pct>              inject stateOfCharge

require('dotenv').config()
process.chdir(__dirname) // checkChargeEditor.test.js runs via `npx playwright test` relative to cwd
const SMA = require('./sma.js')
const Email = require('./email.js')
const fs = require('fs')
const path = require('path')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

const STATE_FILE = path.join(__dirname, 'standby-state.json')
const CONSECUTIVE_THRESHOLD = 2
const ALERT_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (e) {
    return { consecutiveStandby: 0, inStandby: false, lastAlertISO: null, lastSOC: null, firstDetectedISO: null, lastCheckISO: null }
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// Returns { reachable: true|false, inconclusive: bool }. inconclusive = the probe crashed
// (network/portal error) rather than cleanly reporting the editor absent, so we must not
// treat it as a standby detection.
async function probeEditorReachable() {
  if (process.env.STANDBY_TEST_REACHABLE === 'true') return { reachable: true, inconclusive: false }
  if (process.env.STANDBY_TEST_REACHABLE === 'false') return { reachable: false, inconclusive: false }

  let stdout = '', stderr = ''
  try {
    ({ stdout, stderr } = await exec('npx playwright test tests/checkChargeEditor.test.js'))
  } catch (e) {
    stdout = (e.stdout || '') + '\n' + (e.stderr || '')
  }
  const out = `${stdout}\n${stderr}`
  const crashed = /CHARGE_EDITOR_ERROR:/.test(out)
  const m = out.match(/CHARGE_EDITOR_REACHABLE:\s*(true|false)/)
  if (!m) {
    console.log('⚠️  Probe produced no CHARGE_EDITOR_REACHABLE marker - treating as inconclusive')
    return { reachable: false, inconclusive: true }
  }
  const reachable = m[1] === 'true'
  // Editor genuinely reachable is always a clean result. Editor absent is only clean if
  // the probe didn't also error out.
  return { reachable, inconclusive: reachable ? false : crashed }
}

async function getCorroboration() {
  if (process.env.STANDBY_TEST_REACHABLE !== undefined) {
    const batt = process.env.STANDBY_TEST_BATT
    return {
      stateOfCharge: process.env.STANDBY_TEST_SOC !== undefined ? Number(process.env.STANDBY_TEST_SOC) : null,
      batteryCharging: batt === undefined || batt === 'null' ? null : Number(batt),
      pvGeneration: null,
      forecastedGeneration: null,
    }
  }
  try {
    return await SMA.getAllInverterData()
  } catch (e) {
    console.log('⚠️  getAllInverterData failed during corroboration:', e.message)
    return { stateOfCharge: null, batteryCharging: null, pvGeneration: null, forecastedGeneration: null }
  }
}

async function main() {
  const nowISO = new Date().toISOString()
  const nowMs = Date.parse(nowISO)
  const state = loadState()
  state.lastCheckISO = nowISO

  const { reachable, inconclusive } = await probeEditorReachable()
  console.log(`[standby-monitor ${nowISO}] editor reachable=${reachable} inconclusive=${inconclusive}`)

  if (inconclusive) {
    // Don't change the standby streak on an inconclusive probe (network/portal error).
    saveState(state)
    console.log('Inconclusive probe - state unchanged')
    return
  }

  if (reachable) {
    // Normal operation. If we were in standby, announce recovery.
    if (state.inStandby) {
      console.log('✅ Inverter recovered from standby - sending recovery email')
      await Email.sendErrorEmail(
        '✅ SMA inverter recovered from standby',
        'The battery-charge editor is reachable again, so the inverter has come out of standby and charging control is restored.',
        { recoveredAt: nowISO, wasFirstDetected: state.firstDetectedISO }
      )
    }
    saveState({ consecutiveStandby: 0, inStandby: false, lastAlertISO: null, lastSOC: null, firstDetectedISO: null, lastCheckISO: nowISO })
    console.log('Editor reachable - not in standby')
    return
  }

  // Editor unreachable -> corroborate before counting it as standby.
  const data = await getCorroboration()

  // A FAILED scrape returns all-null too, which must NOT masquerade as "battery flow zero".
  // Require a successful read (SOC present) before trusting corroboration; otherwise hold
  // the streak unchanged and wait for a clean reading rather than confirming/denying.
  const scrapeOk = data.stateOfCharge !== null && data.stateOfCharge !== undefined
  if (!scrapeOk) {
    console.log('⚠️  Corroboration unavailable (inverter data scrape failed - no SOC) - holding streak, not confirming standby this cycle')
    saveState(state)
    return
  }

  const battZero = data.batteryCharging === null || data.batteryCharging === undefined || data.batteryCharging === 0
  const socFrozen = state.lastSOC !== null && data.stateOfCharge === state.lastSOC
  const corroborated = battZero || socFrozen
  console.log(`   corroboration: batteryCharging=${data.batteryCharging} (zero/absent=${battZero}), SOC=${data.stateOfCharge} vs last ${state.lastSOC} (frozen=${socFrozen}) => ${corroborated}`)

  if (!corroborated) {
    // Editor unreachable but the inverter is clearly operating (battery flowing, SOC
    // moving). Treat as a transient portal issue, not standby.
    if (state.inStandby) {
      // We had been alerting; the inverter is operating again -> recovery.
      await Email.sendErrorEmail(
        '✅ SMA inverter recovered from standby',
        'The inverter is operating again (battery flow resumed / SOC moving), so it has come out of standby.',
        { recoveredAt: nowISO, wasFirstDetected: state.firstDetectedISO }
      )
    }
    saveState({ consecutiveStandby: 0, inStandby: false, lastAlertISO: null, lastSOC: data.stateOfCharge, firstDetectedISO: null, lastCheckISO: nowISO })
    console.log('Editor unreachable but not corroborated - treating as transient, not standby')
    return
  }

  // Confirmed standby signal.
  state.consecutiveStandby = (state.consecutiveStandby || 0) + 1
  state.lastSOC = data.stateOfCharge
  if (!state.firstDetectedISO) state.firstDetectedISO = nowISO
  console.log(`   confirmed standby detection ${state.consecutiveStandby}/${CONSECUTIVE_THRESHOLD}`)

  if (state.consecutiveStandby >= CONSECUTIVE_THRESHOLD) {
    state.inStandby = true
    const dueForAlert = !state.lastAlertISO || (nowMs - Date.parse(state.lastAlertISO)) >= ALERT_INTERVAL_MS
    if (dueForAlert) {
      console.log('🚨 Sending standby alert email')
      await Email.sendErrorEmail(
        '⚠️ SMA inverter appears to be in STANDBY',
        'The battery-charge editor on Sunny Portal has been unreachable for two consecutive checks and the battery is not charging/discharging — '
        + 'the inverter appears to be in standby (this happens after a power cut) and is not generating or charging. '
        + 'It likely needs a manual restart. Charging control is suspended until it recovers.',
        {
          firstDetected: state.firstDetectedISO,
          consecutiveDetections: state.consecutiveStandby,
          stateOfCharge: data.stateOfCharge,
          batteryCharging: data.batteryCharging,
          pvGeneration: data.pvGeneration,
          forecastedGeneration: data.forecastedGeneration,
        }
      )
      state.lastAlertISO = nowISO
    } else {
      const mins = Math.round((ALERT_INTERVAL_MS - (nowMs - Date.parse(state.lastAlertISO))) / 60000)
      console.log(`Standby confirmed but within 4h rate-limit - next alert in ~${mins} min`)
    }
  } else {
    console.log('Standby detected once - waiting for a second consecutive detection before alerting')
  }

  saveState(state)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[standby-monitor] fatal:', err); process.exit(1) })
