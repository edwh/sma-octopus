require('dotenv').config()
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const Email = require('./email.js')

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

// Cache for forecast data to avoid duplicate Playwright runs
let forecastCache = {
  data: null,
  timestamp: null,
  maxAge: 15 * 60 * 1000 // 15 minutes in milliseconds
}



exports.getAllInverterData = async function () {
  debug('Getting all data from Sunny Portal only - SOC, capacity, power values, and charging state')
  
  let data = {
    stateOfCharge: null,
    consumption: null,
    capacity: null,
    pvGeneration: null,
    purchasedElectricity: null,
    batteryCharging: null,
    isCharging: null,
    forceChargingWindows: null,
    forecastedGeneration: null
  }
  
  try {
    debug('Starting Sunny Portal data collection...')
    
    const maxRetries = 3
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        debug(`Sunny Portal attempt ${attempt}/${maxRetries}`)
        debug('Starting Playwright test execution - this may take 2-3 minutes...')
        
        const startTime = Date.now()
        // Scrape live data. The scrape is self-healing: it reuses the saved session and
        // logs in inline if it has expired (see tests/ennexosSession.js), so no separate
        // auth step is needed here.
        const {stdout, stderr} = await exec('npx playwright test ennexosData.test.js')
        const executionTime = ((Date.now() - startTime) / 1000).toFixed(1)
        debug(`Playwright test completed in ${executionTime} seconds`)
        debug('Sunny Portal data collection completed', {
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        })
        
        const lines = stdout.split('\n')
        let powerValuesFound = 0
        
        // Debug: Log all output lines to see what we're actually getting
        debug('All stdout lines from Playwright test:')
        lines.forEach((line, index) => {
          if (line.trim()) {
            debug(`Line ${index}: ${line}`)
          }
        })
        
        // Parse marker lines emitted by ennexosData.test.js
        for (const line of lines) {
          const cleanLine = line.replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')

          let m
          if ((m = cleanLine.match(/SOC_FROM_ENNEXOS:\s*([0-9.]+)/))) {
            data.stateOfCharge = parseFloat(m[1])
            debug('Found SOC from ennexOS', { soc: data.stateOfCharge })
          }
          if ((m = cleanLine.match(/CAPACITY_FROM_ENNEXOS:\s*([0-9.]+)/))) {
            data.capacity = parseFloat(m[1])
            debug('Found capacity from ennexOS', { capacity: data.capacity })
          }
          if ((m = cleanLine.match(/PV_GENERATION_W:\s*(-?[0-9.]+)/))) {
            data.pvGeneration = parseFloat(m[1])
            powerValuesFound++
          }
          if ((m = cleanLine.match(/CONSUMPTION_W:\s*(-?[0-9.]+)/))) {
            data.consumption = parseFloat(m[1])
            powerValuesFound++
          }
          if ((m = cleanLine.match(/BATTERY_POWER_W:\s*(-?[0-9.]+)/))) {
            // Positive = charging, negative = discharging.
            data.batteryCharging = parseFloat(m[1])
            powerValuesFound++
          }
          if ((m = cleanLine.match(/FORCE_CHARGE_WINDOWS_FOUND:\s*(\d+)/))) {
            data.forceChargingWindows = parseInt(m[1])
          }
          if ((m = cleanLine.match(/FORCE_CHARGE_ACTIVE:\s*(true|false)/))) {
            data.isCharging = m[1] === 'true'
          }
        }

        // Forecast is not yet available from ennexOS; leave null (no target adjustment).
        data.forecastedGeneration = null

        debug('Charging state determination', {
          forceChargingWindows: data.forceChargingWindows,
          isCharging: data.isCharging
        })

        // Derive purchased electricity if not directly available.
        if (data.purchasedElectricity === null && data.consumption !== null && data.pvGeneration !== null) {
          data.purchasedElectricity = Math.max(0, data.consumption - data.pvGeneration)
          debug('Calculated purchased electricity', { purchasedElectricity: data.purchasedElectricity })
        }

        // Check if we got critical data
        const hasEssentialData = data.stateOfCharge !== null || powerValuesFound >= 1
        
        if (hasEssentialData) {
          debug(`✅ Sunny Portal success on attempt ${attempt}`, { 
            soc: data.stateOfCharge,
            capacity: data.capacity,
            powerValues: powerValuesFound 
          })
          break
        } else {
          throw new Error(`Insufficient data from Sunny Portal on attempt ${attempt}`)
        }
        
      } catch (error) {
        debug(`❌ Sunny Portal attempt ${attempt} failed`, { error: error.message })
        
        if (attempt === maxRetries) {
          debug('All Sunny Portal attempts failed - sending alert')
          
          Email.sendErrorEmail('Sunny Portal Data Collection Critical Failure', 
            `Failed to get data from Sunny Portal after ${maxRetries} attempts`, 
            {
              script: 'ennexosAuth.test.js + ennexosData.test.js',
              operation: 'Complete Sunny Portal data collection',
              error: error.message,
              stackTrace: error.stack,
              attempts: maxRetries,
              timestamp: new Date().toISOString(),
              severity: 'HIGH',
              impact: 'No battery or power data available - system cannot function',
              troubleshooting: [
                'Check internet connectivity',
                'Verify Sunny Portal credentials',
                'Check if Sunny Portal service is accessible',
                'Review Playwright browser configuration',
                'Check page structure changes on Sunny Portal'
              ]
            }
          ).catch(emailError => {
            debug('Failed to send Sunny Portal critical alert email', { error: emailError.message })
          })
          
          console.log(`❌ ERROR: Complete failure to access Sunny Portal after ${maxRetries} attempts`)
        } else {
          console.log(`⚠️ Sunny Portal attempt ${attempt} failed, retrying in 10 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 10000))
        }
      }
    }
    
    debug('Sunny Portal data collection result', data)
    
  } catch (e) {
    debug('Error executing Sunny Portal data collection', e)
    console.log('Error getting Sunny Portal data', e)
    
    await Email.sendErrorEmail('Sunny Portal Data Collection Error', e.message, {
      script: 'getAllInverterData (Sunny Portal only)',
      operation: 'Getting all data from Sunny Portal',
      stackTrace: e.stack,
      systemInfo: {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      environment: {
        DEBUG: process.env.DEBUG,
        OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED,
        SUNNY_PORTAL_USERNAME: process.env.SUNNY_PORTAL_USERNAME ? 'SET' : 'NOT_SET'
      }
    })
  }

  console.log('Got Sunny Portal data:', JSON.stringify(data, null, 2))
  return data
}




