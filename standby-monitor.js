// standby-monitor.js — detect the inverter dropping into standby (e.g. after a power
// cut) and alert, rate-limited to at most once every 4 hours.
//
// Primary signal: when the inverter is in standby, Sunny Portal will NOT open the
// battery-charge editor, so tests/checkChargeEditor.test.js reports
// CHARGE_EDITOR_REACHABLE: false. That probe is lightweight and reliable even while the
// inverter is in standby. It is also the functionally meaningful condition — if the
// editor is unreachable we cannot control charging regardless of the root cause.
//
// False-alarm guards:
//   1. Two consecutive detections (~30 min apart) before the first alert — a one-off slow
//      load won't page you.
//   2. Best-effort VETO from the ev-logger's ev-samples.csv: if a FRESH sample shows the
//      battery actively charging/discharging, the inverter is clearly operating, so a
//      momentary editor hiccup is NOT treated as standby. Crucially this is a veto only —
//      *absence* of data (stale/missing sample) does NOT block alerting, because during a
//      real standby the data scrape also fails. (An earlier version REQUIRED a live
//      getForecastData scrape to corroborate; that scrape fails during standby, so standby
//      was never alerted and the failure emailed every cycle. Fixed.)
//
// On recovery (editor reachable again) it sends a one-off "recovered" email and resets.
// Read-only: the probe never saves; this script only reads and writes its own state file.
//
// Testing hooks (bypass the ~5 min Playwright probe for state-machine tests):
//   STANDBY_TEST_REACHABLE=true|false   inject the editor-reachable result
//   STANDBY_TEST_BATT=<W|null>          inject a fresh sample's batteryCharging (veto input)
//   STANDBY_TEST_SOC=<pct>              inject a fresh sample's stateOfCharge

require('dotenv').config()
process.chdir(__dirname) // checkChargeEditor.test.js runs via `npx playwright test` relative to cwd
const Email = require('./email.js')
const fs = require('fs')
const path = require('path')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

const STATE_FILE = path.join(__dirname, 'standby-state.json')
const EV_SAMPLES = path.join(__dirname, 'ev-samples.csv')
const CONSECUTIVE_THRESHOLD = 2
const ALERT_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const SAMPLE_FRESH_MS = 45 * 60 * 1000       // an ev-sample older than this can't veto

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
  return { reachable, inconclusive: reachable ? false : crashed }
}

// Best-effort corroboration from the ev-logger CSV (free - no extra Playwright scrape, so
// it never adds load or spams failure emails). Returns the newest usable row or null.
// Columns: timestamp,consumption,pv,purchased,soc,capacity,batteryCharging,isCharging,forecast
function readLatestEvSample() {
  if (process.env.STANDBY_TEST_REACHABLE !== undefined) {
    if (process.env.STANDBY_TEST_BATT === undefined && process.env.STANDBY_TEST_SOC === undefined) return null
    const b = process.env.STANDBY_TEST_BATT
    return {
      ageMinutes: 0,
      batteryCharging: b === undefined || b === 'null' ? null : Number(b),
      stateOfCharge: process.env.STANDBY_TEST_SOC !== undefined ? Number(process.env.STANDBY_TEST_SOC) : null,
    }
  }
  try {
    const lines = fs.readFileSync(EV_SAMPLES, 'utf8').trim().split('\n')
    for (let i = lines.length - 1; i >= 1; i--) {
      const cols = lines[i].split(',')
      const ts = Date.parse(cols[0])
      if (Number.isNaN(ts)) continue
      const soc = cols[4] === undefined || cols[4] === '' ? null : Number(cols[4])
      const batt = cols[6] === undefined || cols[6] === '' ? null : Number(cols[6])
      return { ageMinutes: (Date.now() - ts) / 60000, batteryCharging: batt, stateOfCharge: soc }
    }
  } catch (e) { /* no CSV yet */ }
  return null
}

async function main() {
  const nowISO = new Date().toISOString()
  const nowMs = Date.parse(nowISO)
  const state = loadState()
  state.lastCheckISO = nowISO

  const { reachable, inconclusive } = await probeEditorReachable()
  console.log(`[standby-monitor ${nowISO}] editor reachable=${reachable} inconclusive=${inconclusive}`)

  if (inconclusive) {
    saveState(state) // don't change the streak on a crashed/ambiguous probe
    console.log('Inconclusive probe - state unchanged')
    return
  }

  // Shared "inverter is operating normally" handling: recovery email if we had alerted, reset.
  const clearToNormal = async (reason) => {
    if (state.inStandby) {
      console.log(`✅ Inverter recovered from standby (${reason}) - sending recovery email`)
      await Email.sendErrorEmail(
        '✅ SMA inverter recovered from standby',
        `The inverter has come out of standby (${reason}), so charging control is restored.`,
        { recoveredAt: nowISO, wasFirstDetected: state.firstDetectedISO }
      )
    }
    saveState({ consecutiveStandby: 0, inStandby: false, lastAlertISO: null, lastSOC: null, firstDetectedISO: null, lastCheckISO: nowISO })
  }

  if (reachable) {
    await clearToNormal('editor reachable again')
    console.log('Editor reachable - not in standby')
    return
  }

  // Editor unreachable. VETO only if a fresh sample positively shows the battery flowing.
  const sample = readLatestEvSample()
  const operating = !!sample
    && sample.ageMinutes < SAMPLE_FRESH_MS / 60000
    && Number.isFinite(sample.batteryCharging)
    && sample.batteryCharging !== 0
  console.log(`   veto check: sample=${sample ? `age ${Math.round(sample.ageMinutes)}min batt=${sample.batteryCharging} soc=${sample.stateOfCharge}` : 'none'} => operating=${operating}`)

  if (operating) {
    await clearToNormal('battery actively flowing - transient editor hiccup, not standby')
    console.log('Editor unreachable but battery flowing - treating as transient, not standby')
    return
  }

  // Not vetoed -> count as a standby detection (works even when scrapes fail).
  state.consecutiveStandby = (state.consecutiveStandby || 0) + 1
  if (sample && sample.stateOfCharge !== null) state.lastSOC = sample.stateOfCharge
  if (!state.firstDetectedISO) state.firstDetectedISO = nowISO
  console.log(`   confirmed standby detection ${state.consecutiveStandby}/${CONSECUTIVE_THRESHOLD}`)

  if (state.consecutiveStandby >= CONSECUTIVE_THRESHOLD) {
    state.inStandby = true
    const dueForAlert = !state.lastAlertISO || (nowMs - Date.parse(state.lastAlertISO)) >= ALERT_INTERVAL_MS
    if (dueForAlert) {
      console.log('🚨 Sending standby alert email')
      await Email.sendErrorEmail(
        '⚠️ SMA inverter appears to be in STANDBY',
        'The battery-charge editor on Sunny Portal has been unreachable for two consecutive checks — the inverter appears to be in standby '
        + '(this happens after a power cut) and is not generating or charging. It likely needs a manual restart. '
        + 'Charging control is suspended until it recovers.',
        {
          firstDetected: state.firstDetectedISO,
          consecutiveDetections: state.consecutiveStandby,
          lastKnownSOC: state.lastSOC,
          latestSample: sample ? `age ${Math.round(sample.ageMinutes)}min, batt=${sample.batteryCharging}, soc=${sample.stateOfCharge}` : 'none',
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
