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
    forceChargingWindows: null
  }
  
  try {
    debug('Starting Sunny Portal data collection...')
    
    const maxRetries = 3
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        debug(`Sunny Portal attempt ${attempt}/${maxRetries}`)
        debug('Starting Playwright test execution - this may take 2-3 minutes...')
        
        const startTime = Date.now()
        const {stdout, stderr} = await exec('npx playwright test getForecastData.test.js')
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
        
        // Parse all data from Sunny Portal output
        for (const line of lines) {
          const cleanLine = line.replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')
          
          // Parse SOC from Sunny Portal
          if (cleanLine.includes('SOC_FROM_SUNNY_PORTAL:')) {
            const match = cleanLine.match(/SOC_FROM_SUNNY_PORTAL:\s*([0-9.]+)/)
            if (match) {
              data.stateOfCharge = parseFloat(match[1])
              debug('Found SOC from Sunny Portal', { soc: data.stateOfCharge })
            }
          }
          
          // Parse capacity from Sunny Portal
          if (cleanLine.includes('CAPACITY_FROM_SUNNY_PORTAL:')) {
            const match = cleanLine.match(/CAPACITY_FROM_SUNNY_PORTAL:\s*([0-9.]+)/)
            if (match) {
              data.capacity = parseFloat(match[1])
              debug('Found capacity from Sunny Portal', { capacity: data.capacity })
            }
          }
          
          // Parse power values
          if (cleanLine.includes('✅ PV Generation:')) {
            const match = cleanLine.match(/PV Generation:\s*([0-9.]+)\s*W/)
            if (match) {
              data.pvGeneration = parseFloat(match[1])
              debug('Found PV generation', { pvGeneration: data.pvGeneration })
              powerValuesFound++
            }
          } else if (cleanLine.includes('✅ Total Consumption:') || cleanLine.includes('✅ Consumption (')) {
            const match = cleanLine.match(/(?:Total )?Consumption[^:]*:\s*([0-9.]+)\s*W/)
            if (match) {
              data.consumption = parseFloat(match[1])
              debug('Found consumption', { consumption: data.consumption })
              powerValuesFound++
            }
          } else if (cleanLine.includes('✅ Purchased Electricity:')) {
            const match = cleanLine.match(/Purchased Electricity:\s*([0-9.]+)\s*W/)
            if (match) {
              data.purchasedElectricity = parseFloat(match[1])
              debug('Found purchased electricity', { purchasedElectricity: data.purchasedElectricity })
              powerValuesFound++
            }
          } else if (cleanLine.includes('✅ Battery Charging:')) {
            const match = cleanLine.match(/Battery Charging:\s*([0-9.]+)\s*W/)
            if (match) {
              data.batteryCharging = parseFloat(match[1])
              debug('Found battery charging', { batteryCharging: data.batteryCharging })
              powerValuesFound++
            }
          }
          
          // Parse force charging windows
          if (cleanLine.includes('FORCE_CHARGE_WINDOWS_FOUND:')) {
            const match = cleanLine.match(/FORCE_CHARGE_WINDOWS_FOUND:\s*(\d+)/)
            if (match) {
              data.forceChargingWindows = parseInt(match[1])
              debug('Found force charging windows count', { forceChargingWindows: data.forceChargingWindows })
            } else if (cleanLine.includes('ERROR')) {
              debug('Error detected in force charging check')
              data.forceChargingWindows = null
            }
          }
        }
        
        // Determine charging state based on force charging windows
        data.isCharging = data.forceChargingWindows !== null ? data.forceChargingWindows > 0 : null
        
        debug('Charging state determination', {
          portalWindowCount: data.forceChargingWindows,
          isCharging: data.isCharging
        })
        
        // Calculate purchased electricity if missing
        if (!data.purchasedElectricity && data.consumption && data.pvGeneration) {
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
              script: 'getForecastData.test.js',
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



exports.getForecastedGeneration = async function () {
  debug('Getting forecasted generation from Sunny Portal')
  
  try {
    debug('Executing getForecastData.test.js via Playwright - this may take 2-3 minutes...')
    const startTime = Date.now()
    const {stdout, stderr} = await exec('npx playwright test getForecastData.test.js')
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(1)
    debug(`Playwright forecast test completed in ${executionTime} seconds`, {
      stdoutLength: stdout.length,
      stderrLength: stderr.length
    })
    
    // Parse the forecast output
    const lines = stdout.split('\n')
    debug('Parsing forecast output lines', { lineCount: lines.length })
    
    let forecastSum = 0
    let forecastFound = false
    
    for (const line of lines) {
      // Remove ANSI color codes for easier parsing
      const cleanLine = line.replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')
      
      // Look for forecast sum in the output
      if (cleanLine.includes('Calculated forecast sum:')) {
        const forecastMatch = cleanLine.match(/Calculated forecast sum:\s*([0-9.]+)\s*kWh/)
        if (forecastMatch) {
          forecastSum = parseFloat(forecastMatch[1])
          forecastFound = true
          debug('Found forecast sum in output', { line: cleanLine, forecastSum })
        }
      }
      
      // Also look for individual energy values if sum not found
      if (!forecastFound && cleanLine.includes('Energy values found on page:')) {
        debug('Found energy values line', { line: cleanLine })
        // Try to parse individual values and sum them
        const energyMatches = cleanLine.match(/(\d+\.?\d*)\s*kWh?/gi) || []
        let calculatedSum = 0
        for (const match of energyMatches) {
          const value = parseFloat(match.replace(/[^\d.]/g, ''))
          if (value > 0 && value < 100) { // Reasonable range for daily generation
            calculatedSum += value
          }
        }
        if (calculatedSum > 0) {
          forecastSum = calculatedSum
          forecastFound = true
          debug('Calculated forecast from energy values', { calculatedSum })
        }
      }
    }
    
    if (!forecastFound) {
      debug('No forecast data found in output, defaulting to 0')
      forecastSum = 0
    }
    
    // Apply forecast multiplier if configured
    const forecastMultiplier = parseFloat(process.env.SUNNY_PORTAL_FORECAST_MULTIPLIER || '100') / 100
    const adjustedForecast = forecastSum * forecastMultiplier
    
    debug('Final forecast result', { 
      rawForecast: forecastSum, 
      multiplier: forecastMultiplier, 
      adjustedForecast 
    })
    
    if (forecastMultiplier !== 1.0) {
      console.log('Raw forecasted generation:', forecastSum, 'kWh')
      console.log('Forecast multiplier applied:', (forecastMultiplier * 100).toFixed(0) + '%')
      console.log('Adjusted forecasted generation for remainder of day:', adjustedForecast.toFixed(2), 'kWh')
    } else {
      console.log('Forecasted generation for remainder of day:', adjustedForecast.toFixed(2), 'kWh')
    }
    
    return adjustedForecast
    
  } catch (e) {
    debug('Error executing forecast test', e)
    console.log('Error getting forecast data:', e.message)
    
    // Send error email with enhanced troubleshooting
    await Email.sendErrorEmail('Sunny Portal Forecast Data Collection Failed', e.message, {
      script: 'getForecastData.test.js',
      operation: 'Getting solar generation forecast from Sunny Portal',
      error: e.message,
      stackTrace: e.stack,
      timestamp: new Date().toISOString(),
      severity: 'MEDIUM',
      impact: 'Solar forecast not available - charging decisions will use standard target SOC without forecast optimization',
      troubleshooting: [
        'Check Sunny Portal login credentials',
        'Verify Sunny Portal URL: ' + (process.env.SUNNY_PORTAL_URL || 'https://www.sunnyportal.com/'),
        'Check if Current Status and Forecast page is accessible',
        'Verify forecast data is available on Sunny Portal',
        'Check if forecast chart/data is loading properly',
        'Review JavaScript data extraction logic',
        'Verify network connectivity to Sunny Portal'
      ],
      systemInfo: {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      environment: {
        DEBUG: process.env.DEBUG,
        SUNNY_PORTAL_URL: process.env.SUNNY_PORTAL_URL,
        SUNNY_PORTAL_USERNAME: process.env.SUNNY_PORTAL_USERNAME ? 'SET' : 'NOT_SET',
        SUNNY_PORTAL_FORECAST_MULTIPLIER: process.env.SUNNY_PORTAL_FORECAST_MULTIPLIER || '100'
      }
    })
    
    // Return 0 as a safe fallback
    debug('Returning 0 forecast as fallback due to error')
    console.log('⚠️ WARNING: Using fallback forecast of 0 kWh due to data collection failure')
    return 0
  }
}

