require('dotenv').config()
const fs = require('fs')
const path = require('path')

// Pure-HTTP ennexOS client - replaces the Playwright/Chromium scripts for normal operation.
// The Sunny Portal ennexOS SPA is backed by a REST API at uiapi.sunnyportal.com with
// OAuth2 (Keycloak) auth. Logging in, reading live data, and controlling force-charge can
// all be done with plain HTTPS calls - no browser - which is dramatically faster and
// lighter on the Raspberry Pi (~1s and negligible RAM vs ~20-40s and hundreds of MB).
//
// Discovered endpoints (componentId = plant id 17318995):
//   POST login.sma.energy/auth/realms/SMA/protocol/openid-connect/token   (password grant)
//   GET  uiapi.sunnyportal.com/api/v1/widgets/energybalance?componentId=   (PV/consumption/battery/SOC)
//   GET  uiapi.sunnyportal.com/api/v1/widgets/componentinfo?componentId=   (nominal capacity/PV)
//   GET  uiapi.sunnyportal.com/api/v1/plants/{id}/energymanagement         (force-charge config)
//   PUT  uiapi.sunnyportal.com/api/v1/plants/{id}/energymanagement/batteryConfig  (set force-charge)

const DEBUG = process.env.DEBUG === 'true'
function debug(message, data = null) {
  if (DEBUG) {
    const ts = new Date().toISOString()
    if (data !== null) console.log(`[DEBUG ${ts}] ENNEXOS-API: ${message}:`, data)
    else console.log(`[DEBUG ${ts}] ENNEXOS-API: ${message}`)
  }
}

const PLANT_ID = process.env.ENNEXOS_PLANT_ID || '17318995'
const CLIENT_ID = 'SPpbeOS'
const TOKEN_URL = 'https://login.sma.energy/auth/realms/SMA/protocol/openid-connect/token'
const API = 'https://uiapi.sunnyportal.com/api/v1'
const TOKEN_CACHE = path.join(__dirname, '.ennexos-token.json')
const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MAX_CHARGING_POWER = 23000 // W (force-charge at max)

// ---- auth -------------------------------------------------------------------

let memToken = null // { accessToken, expiresAt }

async function passwordGrant() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      username: process.env.SUNNY_PORTAL_USERNAME,
      password: process.env.SUNNY_PORTAL_PASSWORD,
      scope: 'openid profile',
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`ennexOS login failed (HTTP ${res.status}): ${t.slice(0, 200)}`)
  }
  const j = await res.json()
  if (!j.access_token) throw new Error('ennexOS login returned no access_token')
  const token = { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 300) * 1000 }
  debug('Obtained new access token', { expiresIn: j.expires_in })
  return token
}

// Return a valid Bearer token, reusing an in-memory / on-disk cached one until ~30s before
// it expires. The disk cache lets separate cron invocations share a token.
async function getToken() {
  const fresh = t => t && t.accessToken && t.expiresAt - Date.now() > 30000
  if (fresh(memToken)) return memToken.accessToken
  try {
    if (fs.existsSync(TOKEN_CACHE)) {
      const disk = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'))
      if (fresh(disk)) { memToken = disk; return disk.accessToken }
    }
  } catch (e) { debug('token cache read failed', e.message) }

  memToken = await passwordGrant()
  try { fs.writeFileSync(TOKEN_CACHE, JSON.stringify(memToken)) } catch (e) { debug('token cache write failed', e.message) }
  return memToken.accessToken
}

async function api(method, endpoint, body) {
  let token = await getToken()
  const doCall = tok => fetch(API + endpoint, {
    method,
    headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let res = await doCall(token)
  if (res.status === 401) {
    // Token rejected (e.g. revoked) - force a fresh login once and retry.
    debug('401 - refreshing token and retrying')
    memToken = null
    try { fs.existsSync(TOKEN_CACHE) && fs.unlinkSync(TOKEN_CACHE) } catch (e) {}
    token = await getToken()
    res = await doCall(token)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`ennexOS API ${method} ${endpoint} failed (HTTP ${res.status}): ${t.slice(0, 200)}`)
  }
  // Some writes return 200/204 with an empty body - don't try to JSON-parse those.
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ---- time window ------------------------------------------------------------

// "HH:MM" in plant-local (Europe/London) time.
function londonHM(date) {
  return date.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, hour: '2-digit', minute: '2-digit' }).replace('24:', '00:')
}
function floor5(date) { return new Date(Math.floor(date.getTime() / 300000) * 300000) }
function hmToMin(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m }

// Force-charge window: from now (floored to 5 min) to the Octopus Go end time (.env, UTC),
// expressed in plant-local time. Falls back to a 30-min window outside the Go window.
function computeWindow() {
  const now = new Date()
  const start = floor5(now)
  const [eh, em] = (process.env.OCTOPUS_GO_END_TIME || '05:30').split(':').map(Number)
  const goEnd = new Date(); goEnd.setUTCHours(eh, em, 0, 0)
  let end = floor5(goEnd)
  if (end <= start) end = new Date(start.getTime() + 30 * 60000)
  return { startStr: londonHM(start), endStr: londonHM(end) }
}

// Does a "HH:MM[:SS]-HH:MM[:SS]" timeframe cover the current plant-local time?
function windowCoversNow(startLocal, endLocal) {
  const nowMin = hmToMin(londonHM(new Date()))
  const s = hmToMin(startLocal.slice(0, 5)), e = hmToMin(endLocal.slice(0, 5))
  return s <= e ? (nowMin >= s && nowMin < e) : (nowMin >= s || nowMin < e)
}

// ---- reads ------------------------------------------------------------------

// Live plant data, shaped to match what sma.js/server.js expect.
exports.getData = async function () {
  const [balance, info, em] = await Promise.all([
    api('GET', `/widgets/energybalance?componentId=${PLANT_ID}`),
    api('GET', `/widgets/componentinfo?componentId=${PLANT_ID}`),
    api('GET', `/plants/${PLANT_ID}/energymanagement`),
  ])

  const capFeature = (info.infoWidgetFeatures || []).find(f => f.infoWidgetType === 'BatteryCapacity')
  const capacity = capFeature ? parseFloat(capFeature.value) / 1000 : null // Wh -> kWh

  const tf = (em.batteryManagementConfiguration || {}).timeframeBasedBatteryCharging || {}
  const windows = tf.timeframes || []
  const windowActive = windows.some(w => windowCoversNow(w.timestampStartLocal, w.timestampEndLocal))
  const forceChargeActive = tf.isActive === true && windowActive

  // batteryPower: positive when charging (energybalance splits charge/discharge).
  const batteryPower = (balance.batteryCharging || 0) - (balance.batteryDischarging || 0)

  const data = {
    stateOfCharge: balance.batteryStateOfCharge != null ? Math.round(balance.batteryStateOfCharge * 1000) / 10 : null, // 0.12 -> 12
    capacity,
    pvGeneration: balance.pvGeneration != null ? balance.pvGeneration : null,
    consumption: balance.totalConsumption != null ? balance.totalConsumption : null,
    purchasedElectricity: balance.externalConsumption != null ? balance.externalConsumption : null,
    batteryCharging: batteryPower,
    isCharging: forceChargeActive,
    forceChargingWindows: tf.isActive ? windows.length : 0,
    forecastedGeneration: null, // populated by forecast.js in server.js
  }
  debug('getData', data)
  return data
}

// ---- control ----------------------------------------------------------------

// Build the batteryConfig PUT body from the current config, overriding the time-controlled
// charging section. Preserves the priority/forecast-based settings.
function buildConfigBody(current, timeframeCfg) {
  const bmc = current.batteryManagementConfiguration || {}
  const pri = bmc.priorityBasedBatteryCharging || { isActive: false }
  const fc = bmc.forecastBasedBatteryCharging || {}
  return {
    priorityBasedBatteryCharging: { isActive: !!pri.isActive },
    timeframeBasedBatteryCharging: timeframeCfg,
    forecastBasedBatteryCharging: {
      isActive: !!fc.isActive,
      minimumStateOfCharge: fc.minimumStateOfCharge || 0,
      reducedRange: !!fc.reducedRange,
      hasHybridInverterWithInitialConfiguration: !!fc.hasHybridInverterWithInitialConfiguration,
    },
  }
}

// Turn force charging on (one now->Go-end window at max power) or off. Read-modify-write
// against the energymanagement config, then verify the change persisted.
exports.setForceCharge = async function (on) {
  const current = await api('GET', `/plants/${PLANT_ID}/energymanagement`)
  const existing = ((current.batteryManagementConfiguration || {}).timeframeBasedBatteryCharging || {}).timeframes || []

  let timeframeCfg
  if (on) {
    const { startStr, endStr } = computeWindow()
    console.log(`Setting force-charge window (Europe/London): ${startStr} - ${endStr} at ${MAX_CHARGING_POWER} W`)
    timeframeCfg = {
      isActive: true,
      timeframes: [{
        isNominalChargingPower: false,
        chargingPower: MAX_CHARGING_POWER,
        timestampStartLocal: startStr,
        timestampEndLocal: endStr,
        validDays: ALL_DAYS,
      }],
    }
  } else {
    // Deactivate; keep the existing timeframe (or a harmless default) so the shape is valid.
    const keep = existing.length ? existing.map(w => ({
      isNominalChargingPower: !!w.isNominalChargingPower,
      chargingPower: w.chargingPower || MAX_CHARGING_POWER,
      timestampStartLocal: (w.timestampStartLocal || '04:00:00').slice(0, 5),
      timestampEndLocal: (w.timestampEndLocal || '04:30:00').slice(0, 5),
      validDays: w.validDays && w.validDays.length ? w.validDays : ALL_DAYS,
    })) : [{ isNominalChargingPower: false, chargingPower: MAX_CHARGING_POWER, timestampStartLocal: '04:00', timestampEndLocal: '04:30', validDays: ALL_DAYS }]
    timeframeCfg = { isActive: false, timeframes: keep }
  }

  await api('PUT', `/plants/${PLANT_ID}/energymanagement/batteryConfig`, buildConfigBody(current, timeframeCfg))

  // Verify the toggle persisted so a silent failure can't fake a state change.
  const after = await api('GET', `/plants/${PLANT_ID}/energymanagement`)
  const isActive = ((after.batteryManagementConfiguration || {}).timeframeBasedBatteryCharging || {}).isActive
  if (isActive !== on) throw new Error(`force-charge ${on ? 'ON' : 'OFF'} did not persist (isActive=${isActive})`)
  console.log(`Force charge ${on ? 'ON' : 'OFF'} - saved and verified`)
  return true
}
