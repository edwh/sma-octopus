require('dotenv').config()

// Solar generation forecast.
//
// The ennexOS SPA does NOT expose a PV forecast (its charts only fetch actual measurement
// channels; the old classic Sunny Portal "Status and Forecast" page that used to provide it
// is dead). So we get "expected kWh today" from the free forecast.solar API, driven entirely
// by .env config. If the location isn't configured (or the call fails) this returns null and
// the pipeline simply proceeds with no forecast-based target reduction.
//
// Configure in .env to enable:
//   SOLAR_FORECAST_LAT, SOLAR_FORECAST_LON         (plant latitude/longitude, decimal degrees)
//   SOLAR_FORECAST_DECLINATION   panel tilt from horizontal in degrees (default 35)
//   SOLAR_FORECAST_AZIMUTH       -90=E, 0=S, 90=W  (default 0 = due south)
//   SOLAR_FORECAST_KWP           array size in kWp (default 9.3, the plant's nominal PV power)
//   SOLAR_FORECAST_MULTIPLIER    optional % tuning for shading/soiling (default 100)

const DEBUG = process.env.DEBUG === 'true'
function debug(message, data = null) {
  if (DEBUG) {
    const ts = new Date().toISOString()
    if (data !== null) console.log(`[DEBUG ${ts}] FORECAST: ${message}:`, data)
    else console.log(`[DEBUG ${ts}] FORECAST: ${message}`)
  }
}

// Returns today's total estimated PV generation in kWh (Europe/London), or null if the
// forecast is not configured or unavailable.
exports.getSolarForecastKwh = async function () {
  const lat = process.env.SOLAR_FORECAST_LAT
  const lon = process.env.SOLAR_FORECAST_LON
  if (!lat || !lon) {
    debug('Solar forecast not configured (SOLAR_FORECAST_LAT/LON unset) - skipping')
    return null
  }

  const dec = process.env.SOLAR_FORECAST_DECLINATION || '35'
  const az = process.env.SOLAR_FORECAST_AZIMUTH || '0'
  const kwp = process.env.SOLAR_FORECAST_KWP || '9.3'
  const url = `https://api.forecast.solar/estimate/${lat}/${lon}/${dec}/${az}/${kwp}`
  debug('Fetching solar forecast', { url })

  try {
    const res = await fetch(url)
    if (!res.ok) {
      // 429 = rate limited (free tier allows a limited number of calls/hour).
      debug('forecast.solar request failed', { status: res.status, statusText: res.statusText })
      console.log(`⚠️ Solar forecast unavailable (HTTP ${res.status}) - proceeding without forecast`)
      return null
    }
    const data = await res.json()
    const perDay = data && data.result && data.result.watt_hours_day
    if (!perDay) {
      debug('forecast.solar response had no watt_hours_day', data)
      return null
    }

    // Pick today's entry (Europe/London); fall back to the first day returned.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) // YYYY-MM-DD
    const wh = (perDay[today] !== undefined) ? perDay[today] : Object.values(perDay)[0]
    if (wh === undefined || wh === null) return null

    const mult = parseFloat(process.env.SOLAR_FORECAST_MULTIPLIER || '100') / 100
    const kwh = (wh / 1000) * mult
    debug('Solar forecast for today', { today, wh, multiplier: mult, kwh })
    console.log(`☀️ Solar forecast (forecast.solar): ${kwh.toFixed(1)} kWh today`)
    return kwh
  } catch (e) {
    debug('Error fetching solar forecast', e)
    console.log('⚠️ Solar forecast error:', e.message, '- proceeding without forecast')
    return null
  }
}
