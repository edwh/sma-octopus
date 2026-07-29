require('dotenv').config()
const Email = require('./email.js')
const EnnexosApi = require('./ennexosApi.js')

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

  // All attempts failed - alert and return a null-filled structure so callers degrade safely.
  console.log(`❌ ERROR: Failed to get data from ennexOS API after ${maxRetries} attempts`)
  await Email.sendErrorEmail('ennexOS Data Collection Critical Failure',
    `Failed to get data from the ennexOS API after ${maxRetries} attempts`,
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
