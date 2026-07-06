// ev-logger.js — read-only daytime sampler for EV-charging inference.
//
// Appends one row of inverter telemetry to ev-samples.csv each time it runs.
// Intended to be driven by cron every 30 min across the daytime window
// (07:00–19:00) so we can later detect the EV's ~3.5–4 kW charging signature
// in house consumption, integrate its energy, and tell a completed charge
// (load tapers to ~0) from an interrupted one (load cut off at full power).
//
// This script makes NO changes to the battery or Sunny Portal — it only reads.
// It mirrors how server.js loads config and calls the inverter.

require('dotenv').config()
process.chdir(__dirname) // sma.js shells out to `npx playwright test ...` relative to cwd
const SMA = require('./sma.js')
const fs = require('fs')
const path = require('path')

const CSV_FILE = path.join(__dirname, 'ev-samples.csv')
const HEADER = 'timestamp,consumption_W,pvGeneration_W,purchasedElectricity_W,stateOfCharge_pct,capacity,batteryCharging,isCharging,forecastedGeneration_kWh\n'

function csvCell(v) {
  // null/undefined -> empty cell; everything else stringified as-is (all numeric/bool here)
  return v === null || v === undefined ? '' : String(v)
}

async function main() {
  const timestamp = new Date().toISOString()
  let data
  try {
    data = await SMA.getAllInverterData()
  } catch (e) {
    // Record the failed attempt so gaps are visible rather than silent.
    console.error(`[ev-logger ${timestamp}] getAllInverterData failed:`, e.message)
    data = {}
  }

  const row = [
    timestamp,
    csvCell(data.consumption),
    csvCell(data.pvGeneration),
    csvCell(data.purchasedElectricity),
    csvCell(data.stateOfCharge),
    csvCell(data.capacity),
    csvCell(data.batteryCharging),
    csvCell(data.isCharging),
    csvCell(data.forecastedGeneration),
  ].join(',') + '\n'

  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, HEADER)
  }
  fs.appendFileSync(CSV_FILE, row)
  console.log(`[ev-logger ${timestamp}] logged: ${row.trim()}`)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[ev-logger] fatal:', err); process.exit(1) })
