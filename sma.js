require('dotenv').config()
const Email = require('./email.js')
const EnnexosApi = require('./ennexosApi.js')
const fs = require('fs')
const path = require('path')

// Only alert on a SUSTAINED data-collection outage, not a one-off transient network blip
// (e.g. a brief DNS/connection hiccup on the Pi - seen 2026-07-29, all 3 in-cycle retries
// got "fetch failed" for ~40s then the next cycle succeeded). Require this many consecutive
// FAILED CYCLES before emailing, and rate-limit repeats.
const FAILURE_STATE_FILE = path.join(__dirname, 'data-failure-state.json')
const FAILURE_ALERT_THRESHOLD = 2
const FAILURE_ALERT_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

function readFailureState() {
  try { return JSON.parse(fs.readFileSync(FAILURE_STATE_FILE, 'utf8')) } catch (e) { return { consecutiveFailures: 0, lastAlertISO: null } }
}
function writeFailureState(s) {
  try { fs.writeFileSync(FAILURE_STATE_FILE, JSON.stringify(s)) } catch (e) { /* best effort */ }
}

// Debug logging utility
const DEBUG = process.env.DEBUG === 'true'
function debug(message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString()
    if (data !== null) {
      console.log(`[DEBUG ${timestamp}] SMA: ${message}:`, data)
    } else {
      console.log(`[DEBUG ${timestamp}] SMA: ${message}`)
    }
  }
}

// Collect all live plant data from the ennexOS REST API (uiapi.sunnyportal.com). This
// replaces the old Playwright/Chromium scrape - it's plain HTTPS, so it runs in ~1s with
// negligible memory (important on the Raspberry Pi) instead of ~20-40s of headless Chrome.
// See ennexosApi.js for the endpoints and auth.
exports.getAllInverterData = async function () {
  debug('Getting all data from ennexOS API - SOC, capacity, power values, and charging state')

  const maxRetries = 3
  let lastError = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      debug(`ennexOS API attempt ${attempt}/${maxRetries}`)
      const data = await EnnexosApi.getData()

      // Require at least the essentials (SOC drives every charge decision).
      if (data.stateOfCharge === null || data.stateOfCharge === undefined) {
        throw new Error('ennexOS API returned no state of charge')
      }

      debug(`ennexOS API success on attempt ${attempt}`, data)
      console.log('Got ennexOS data:', JSON.stringify(data, null, 2))
      // Recovered - clear any consecutive-failure streak.
      if (readFailureState().consecutiveFailures > 0) writeFailureState({ consecutiveFailures: 0, lastAlertISO: null })
      return data
    } catch (error) {
      lastError = error
      debug(`ennexOS API attempt ${attempt} failed`, { error: error.message })
      if (attempt < maxRetries) {
        console.log(`⚠️ ennexOS API attempt ${attempt} failed, retrying in 5 seconds...`)
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
  }

  // All in-cycle retries failed. Only alert if this has now failed FAILURE_ALERT_THRESHOLD
  // cycles in a row (a sustained outage), rate-limited - so a single transient blip is silent.
  console.log(`❌ ERROR: Failed to get data from ennexOS API after ${maxRetries} attempts`)
  const failState = readFailureState()
  failState.consecutiveFailures = (failState.consecutiveFailures || 0) + 1
  const nowMs = Date.now()
  const dueForAlert = failState.consecutiveFailures >= FAILURE_ALERT_THRESHOLD
    && (!failState.lastAlertISO || nowMs - Date.parse(failState.lastAlertISO) >= FAILURE_ALERT_INTERVAL_MS)

  if (!dueForAlert) {
    const reason = failState.consecutiveFailures < FAILURE_ALERT_THRESHOLD
      ? `transient (${failState.consecutiveFailures}/${FAILURE_ALERT_THRESHOLD} consecutive) - not alerting`
      : 'within 4h rate-limit - not re-alerting'
    console.log(`ennexOS data collection failed but ${reason}`)
    writeFailureState(failState)
    return {
      stateOfCharge: null,
      consumption: null,
      capacity: null,
      pvGeneration: null,
      purchasedElectricity: null,
      batteryCharging: null,
      isCharging: null,
      forceChargingWindows: null,
      forecastedGeneration: null,
    }
  }

  failState.lastAlertISO = new Date().toISOString()
  writeFailureState(failState)
  await Email.sendErrorEmail('ennexOS Data Collection Critical Failure',
    `Failed to get data from the ennexOS API for ${failState.consecutiveFailures} consecutive cycles`,
    {
      script: 'ennexosApi.getData()',
      operation: 'Complete ennexOS data collection',
      error: lastError ? lastError.message : 'unknown',
      stackTrace: lastError ? lastError.stack : null,
      attempts: maxRetries,
      timestamp: new Date().toISOString(),
      severity: 'HIGH',
      impact: 'No battery or power data available - system cannot make a charge decision',
      troubleshooting: [
        'Check internet connectivity from the Pi',
        'Verify SUNNY_PORTAL_USERNAME / SUNNY_PORTAL_PASSWORD in .env',
        'Check whether login.sma.energy / uiapi.sunnyportal.com are reachable',
        'The SMA API auth (client SPpbeOS / password grant) or endpoints may have changed',
      ],
    }
  ).catch(emailError => debug('Failed to send ennexOS critical alert email', { error: emailError.message }))

  return {
    stateOfCharge: null,
    consumption: null,
    capacity: null,
    pvGeneration: null,
    purchasedElectricity: null,
    batteryCharging: null,
    isCharging: null,
    forceChargingWindows: null,
    forecastedGeneration: null,
  }
}
