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
  debug('Getting hybrid data - SOC from inverter, power values from Sunny Portal')
  
  let data = {
    stateOfCharge: null,
    consumption: null,
    capacity: null,
    isCharging: null,
    pvGeneration: null,
    purchasedElectricity: null,
    batteryCharging: null
  }
  
  try {
    debug('Starting parallel data collection: SOC from SMA inverter + current status from Sunny Portal')
    
    // Run both data collection tasks in parallel for better performance
    const [socData, sunnyPortalData] = await Promise.all([
      // Get SOC from SMA inverter
      exec('npx playwright test getAllInverterData.test.js').then(({stdout, stderr}) => {
        debug('SMA inverter SOC collection completed', {
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        })
        
        const lines = stdout.split('\n')
        let socResult = { stateOfCharge: null, isCharging: null, capacity: null }
        
        for (const line of lines) {
          const cleanLine = line.replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')
          
          if (cleanLine.includes('AllData')) {
            try {
              const jsonMatch = cleanLine.match(/AllData\s+(.+)/)
              if (jsonMatch) {
                let jsonString = jsonMatch[1]
                
                if (jsonString.includes('{') && !jsonString.includes('}')) {
                  debug('JSON appears incomplete, looking for continuation...')
                  const currentIndex = lines.indexOf(line)
                  for (let i = currentIndex + 1; i < Math.min(currentIndex + 10, lines.length); i++) {
                    const nextLine = lines[i].replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')
                    jsonString += nextLine
                    if (nextLine.includes('}')) {
                      debug('Found JSON continuation, attempting to parse complete JSON')
                      break
                    }
                  }
                }
                
                const parsedData = JSON.parse(jsonString)
                socResult = { ...socResult, ...parsedData }
                debug('Parsed SMA inverter data', parsedData)
              }
            } catch (e) {
              debug('Failed to parse SMA JSON data', { error: e.message, line: cleanLine })
            }
          }
        }
        
        return socResult
      }),
      
      // Get current power values from Sunny Portal
      exec('npx playwright test getForecastData.test.js').then(({stdout, stderr}) => {
        debug('Sunny Portal data collection completed', {
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        })
        
        const lines = stdout.split('\n')
        let portalResult = { 
          pvGeneration: null,
          consumption: null,
          purchasedElectricity: null,
          batteryCharging: null
        }
        
        // Look for current status values in Sunny Portal output
        for (const line of lines) {
          const cleanLine = line.replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')
          
          // Parse current status values from both the old and new getCurrentStatusFromSunnyPortal functions
          if (cleanLine.includes('Found PV generation:')) {
            const match = cleanLine.match(/Found PV generation:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.pvGeneration = parseFloat(match[1])
              debug('Found PV generation in Sunny Portal', { pvGeneration: portalResult.pvGeneration })
            }
          } else if (cleanLine.includes('Found total consumption:')) {
            const match = cleanLine.match(/Found total consumption:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.consumption = parseFloat(match[1])
              debug('Found consumption in Sunny Portal', { consumption: portalResult.consumption })
            }
          } else if (cleanLine.includes('Found battery charging:')) {
            const match = cleanLine.match(/Found battery charging:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.batteryCharging = parseFloat(match[1])
              debug('Found battery charging in Sunny Portal', { batteryCharging: portalResult.batteryCharging })
            }
          } else if (cleanLine.includes('✅ PV Generation:')) {
            const match = cleanLine.match(/PV Generation:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.pvGeneration = parseFloat(match[1])
              debug('Found PV generation in Sunny Portal (new format)', { pvGeneration: portalResult.pvGeneration })
            }
          } else if (cleanLine.includes('✅ Total Consumption:') || cleanLine.includes('✅ Consumption (')) {
            const match = cleanLine.match(/(?:Total )?Consumption[^:]*:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.consumption = parseFloat(match[1])
              debug('Found consumption in Sunny Portal (new format)', { consumption: portalResult.consumption })
            }
          } else if (cleanLine.includes('✅ Purchased Electricity:')) {
            const match = cleanLine.match(/Purchased Electricity:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.purchasedElectricity = parseFloat(match[1])
              debug('Found purchased electricity in Sunny Portal', { purchasedElectricity: portalResult.purchasedElectricity })
            }
          } else if (cleanLine.includes('✅ Battery Charging:')) {
            const match = cleanLine.match(/Battery Charging:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.batteryCharging = parseFloat(match[1])
              debug('Found battery charging in Sunny Portal (new format)', { batteryCharging: portalResult.batteryCharging })
            }
          }
          
          // Also look for explicit current status value patterns from the Sunny Portal page
          // Based on the output: "PV power generation 6.88 kW" etc
          const pvMatch = cleanLine.match(/PV power generation.*?([0-9.]+)\s*kW/i)
          if (pvMatch && !portalResult.pvGeneration) {
            portalResult.pvGeneration = parseFloat(pvMatch[1]) * 1000 // Convert kW to W
            debug('Found PV generation from page text', { pvGeneration: portalResult.pvGeneration })
          }
          
          const consumptionMatch = cleanLine.match(/Total consumption.*?([0-9.]+)\s*kW/i)
          if (consumptionMatch && !portalResult.consumption) {
            portalResult.consumption = parseFloat(consumptionMatch[1]) * 1000 // Convert kW to W
            debug('Found consumption from page text', { consumption: portalResult.consumption })
          }
          
          const batteryMatch = cleanLine.match(/Battery charging.*?([0-9.]+)\s*kW/i)
          if (batteryMatch && !portalResult.batteryCharging) {
            portalResult.batteryCharging = parseFloat(batteryMatch[1]) * 1000 // Convert kW to W
            debug('Found battery charging from page text', { batteryCharging: portalResult.batteryCharging })
          }
          
          const feedInMatch = cleanLine.match(/Grid feed-in.*?([0-9.]+)\s*kW/i)
          if (feedInMatch && !portalResult.purchasedElectricity) {
            // Grid feed-in means we're exporting, so purchased electricity is 0
            // But we need to calculate purchased electricity from consumption and PV generation
            // This will be done after we have all values
            debug('Found grid feed-in from page text', { feedIn: parseFloat(feedInMatch[1]) * 1000 })
          }
        }
        
        // Calculate purchased electricity if we have the other values but not this one
        if (!portalResult.purchasedElectricity && portalResult.consumption && portalResult.pvGeneration) {
          // Purchased = consumption - PV generation (if PV < consumption)
          portalResult.purchasedElectricity = Math.max(0, portalResult.consumption - portalResult.pvGeneration)
          debug('Calculated purchased electricity', { purchasedElectricity: portalResult.purchasedElectricity })
        }
        
        return portalResult
      })
    ])
    
    // Combine the results - SOC from inverter, power values from Sunny Portal
    data = {
      stateOfCharge: socData.stateOfCharge,
      isCharging: socData.isCharging,
      capacity: socData.capacity,
      pvGeneration: sunnyPortalData.pvGeneration,
      consumption: sunnyPortalData.consumption,
      purchasedElectricity: sunnyPortalData.purchasedElectricity,
      batteryCharging: sunnyPortalData.batteryCharging
    }
    
    debug('Combined hybrid data result', data)
    
  } catch (e) {
    debug('Error executing hybrid data collection', e)
    console.log('Error getting hybrid data', e)
    
    // Send error email with comprehensive details
    await Email.sendErrorEmail('Hybrid Data Collection Error', e.message, {
      script: 'getAllInverterData (hybrid)',
      operation: 'Getting hybrid data - SOC from inverter + power from Sunny Portal',
      stackTrace: e.stack,
      systemInfo: {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      environment: {
        DEBUG: process.env.DEBUG,
        inverterIP: process.env.inverterIP,
        OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED,
        SUNNY_PORTAL_USERNAME: process.env.SUNNY_PORTAL_USERNAME ? 'SET' : 'NOT_SET'
      }
    })
  }

  console.log('Got hybrid data:', JSON.stringify(data, null, 2))
  return data
}


// Legacy functions - kept for backward compatibility but recommend using getAllInverterData()
exports.getStateOfCharge = async function () {
  debug('Getting SOC via legacy method - consider using getAllInverterData()')
  try {
    const data = await exports.getAllInverterData()
    return data.stateOfCharge
  } catch (e) {
    await Email.sendErrorEmail('Legacy SOC Error', e.message, {
      script: 'getStateOfCharge (legacy)',
      operation: 'Getting state of charge',
      stackTrace: e.stack
    })
    throw e
  }
}

exports.getCurrentConsumption = async function () {
  debug('Getting consumption via legacy method - consider using getAllInverterData()')
  try {
    const data = await exports.getAllInverterData()
    return data.consumption
  } catch (e) {
    await Email.sendErrorEmail('Legacy Consumption Error', e.message, {
      script: 'getCurrentConsumption (legacy)',
      operation: 'Getting current consumption',
      stackTrace: e.stack
    })
    throw e
  }
}

exports.getBatteryCapacity = async function () {
  debug('Getting capacity via legacy method - consider using getAllInverterData()')
  try {
    const data = await exports.getAllInverterData()
    return data.capacity
  } catch (e) {
    await Email.sendErrorEmail('Legacy Capacity Error', e.message, {
      script: 'getBatteryCapacity (legacy)',
      operation: 'Getting battery capacity',
      stackTrace: e.stack
    })
    throw e
  }
}

exports.getForecastedGeneration = async function () {
  debug('Getting forecasted generation from Sunny Portal')
  
  try {
    debug('Executing getForecastData.test.js via Playwright')
    const {stdout, stderr} = await exec('npx playwright test getForecastData.test.js')
    debug('Playwright forecast test completed', {
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
    
    // Send error email
    await Email.sendErrorEmail('Sunny Portal Forecast Error', e.message, {
      script: 'getForecastData.test.js',
      operation: 'Getting forecast generation',
      stackTrace: e.stack,
      systemInfo: {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      environment: {
        DEBUG: process.env.DEBUG,
        SUNNY_PORTAL_URL: process.env.SUNNY_PORTAL_URL,
        SUNNY_PORTAL_USERNAME: process.env.SUNNY_PORTAL_USERNAME ? 'SET' : 'NOT_SET'
      }
    })
    
    // Return 0 as a safe fallback
    debug('Returning 0 forecast as fallback due to error')
    return 0
  }
}