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
    debug('Starting sequential data collection: SOC from SMA inverter first, then current status from Sunny Portal')
    
    // Get SOC from SMA inverter first with retry logic
    debug('Step 1: Getting SOC from SMA inverter...')
    let socData = null
    const maxRetries = 3
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        debug(`SMA inverter attempt ${attempt}/${maxRetries}`)
        
        socData = await exec('npx playwright test getAllInverterData.test.js').then(({stdout, stderr}) => {
        debug('SMA inverter SOC collection completed', {
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        })
        
        const lines = stdout.split('\n')
        let socResult = { stateOfCharge: null, isCharging: null, capacity: null }
        let dataFound = false
        
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
                dataFound = true
              }
            } catch (e) {
              debug('Failed to parse SMA JSON data', { error: e.message, line: cleanLine })
            }
          }
        }
        
        // Check if we got critical data (SOC)
        if (!dataFound || socResult.stateOfCharge === null) {
          debug('Failed to extract SOC from SMA inverter - sending alert email')
          
          // Send alert email for SMA inverter failure
          Email.sendErrorEmail('SMA Inverter Data Collection Failed', 
            'Failed to retrieve battery state of charge from SMA inverter interface', 
            {
              script: 'getAllInverterData.test.js',
              operation: 'Getting battery SOC from SMA inverter',
              extractedData: socResult,
              stdoutLength: stdout.length,
              stderrLength: stderr.length,
              timestamp: new Date().toISOString(),
              severity: 'HIGH',
              impact: 'Battery SOC not available - may affect charging decisions',
              troubleshooting: [
                'Check SMA inverter is accessible at ' + (process.env.inverterIP || 'unknown IP'),
                'Verify installer password is correct',
                'Check if SMA interface is responding',
                'Review Playwright test logs for connection issues'
              ]
            }
          ).catch(emailError => {
            debug('Failed to send SMA inverter alert email', { error: emailError.message })
          })
          
          console.log('⚠️ WARNING: Failed to get battery SOC from SMA inverter')
        }
        
        return socResult
        })
        
        // Check if we got critical data (SOC)
        if (socData && socData.stateOfCharge !== null) {
          debug(`✅ SMA inverter success on attempt ${attempt}`, { soc: socData.stateOfCharge })
          break
        } else {
          throw new Error(`No SOC data extracted on attempt ${attempt}`)
        }
        
      } catch (error) {
        debug(`❌ SMA inverter attempt ${attempt} failed`, { error: error.message })
        
        if (attempt === maxRetries) {
          // Final attempt failed - send critical alert email
          debug('All SMA inverter attempts failed - sending critical alert')
          
          Email.sendErrorEmail('SMA Inverter Collection Critical Failure', 
            `Failed to get data from SMA inverter after ${maxRetries} attempts`, 
            {
              script: 'getAllInverterData.test.js',
              operation: 'SMA inverter data collection with retries',
              error: error.message,
              stackTrace: error.stack,
              attempts: maxRetries,
              timestamp: new Date().toISOString(),
              severity: 'CRITICAL',
              impact: 'No battery data available - charging system may not function correctly',
              troubleshooting: [
                'Check SMA inverter network connectivity',
                'Verify inverter IP address: ' + (process.env.inverterIP || 'not set'),
                'Check installer credentials',
                'Verify SMA inverter is powered on and responding',
                'Check firewall/network access to inverter',
                'Review Playwright test execution logs',
                'Consider increasing retry count or timeout values'
              ]
            }
          ).catch(emailError => {
            debug('Failed to send SMA critical alert email', { error: emailError.message })
          })
          
          console.log(`❌ CRITICAL: Complete failure to access SMA inverter after ${maxRetries} attempts`)
          socData = { stateOfCharge: null, isCharging: null, capacity: null }
        } else {
          // Wait before retry
          console.log(`⚠️ SMA inverter attempt ${attempt} failed, retrying in 5 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
      }
    }
    
    debug('Step 2: Getting current status from Sunny Portal...')
    let sunnyPortalData = null
    const maxPortalRetries = 3
    
    for (let attempt = 1; attempt <= maxPortalRetries; attempt++) {
      try {
        debug(`Sunny Portal attempt ${attempt}/${maxPortalRetries}`)
        
        sunnyPortalData = await exec('npx playwright test getForecastData.test.js').then(({stdout, stderr}) => {
        debug('Sunny Portal data collection completed', {
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        })
        
        const lines = stdout.split('\n')
        let portalResult = { 
          pvGeneration: null,
          consumption: null,
          purchasedElectricity: null,
          batteryCharging: null,
          forceChargingWindows: null
        }
        let powerValuesFound = 0
        
        // Look for current status values in Sunny Portal output
        for (const line of lines) {
          const cleanLine = line.replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')
          
          // Parse current status values from both the old and new getCurrentStatusFromSunnyPortal functions
          if (cleanLine.includes('Found PV generation:')) {
            const match = cleanLine.match(/Found PV generation:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.pvGeneration = parseFloat(match[1])
              debug('Found PV generation in Sunny Portal', { pvGeneration: portalResult.pvGeneration })
              powerValuesFound++
            }
          } else if (cleanLine.includes('Found total consumption:')) {
            const match = cleanLine.match(/Found total consumption:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.consumption = parseFloat(match[1])
              debug('Found consumption in Sunny Portal', { consumption: portalResult.consumption })
              powerValuesFound++
            }
          } else if (cleanLine.includes('Found battery charging:')) {
            const match = cleanLine.match(/Found battery charging:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.batteryCharging = parseFloat(match[1])
              debug('Found battery charging in Sunny Portal', { batteryCharging: portalResult.batteryCharging })
              powerValuesFound++
            }
          } else if (cleanLine.includes('✅ PV Generation:')) {
            const match = cleanLine.match(/PV Generation:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.pvGeneration = parseFloat(match[1])
              debug('Found PV generation in Sunny Portal (new format)', { pvGeneration: portalResult.pvGeneration })
              powerValuesFound++
            }
          } else if (cleanLine.includes('✅ Total Consumption:') || cleanLine.includes('✅ Consumption (')) {
            const match = cleanLine.match(/(?:Total )?Consumption[^:]*:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.consumption = parseFloat(match[1])
              debug('Found consumption in Sunny Portal (new format)', { consumption: portalResult.consumption })
              powerValuesFound++
            }
          } else if (cleanLine.includes('✅ Purchased Electricity:')) {
            const match = cleanLine.match(/Purchased Electricity:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.purchasedElectricity = parseFloat(match[1])
              debug('Found purchased electricity in Sunny Portal', { purchasedElectricity: portalResult.purchasedElectricity })
              powerValuesFound++
            }
          } else if (cleanLine.includes('✅ Battery Charging:')) {
            const match = cleanLine.match(/Battery Charging:\s*([0-9.]+)\s*W/)
            if (match) {
              portalResult.batteryCharging = parseFloat(match[1])
              debug('Found battery charging in Sunny Portal (new format)', { batteryCharging: portalResult.batteryCharging })
              powerValuesFound++
            }
          } else if (cleanLine.includes('FORCE_CHARGE_WINDOWS_FOUND:')) {
            const match = cleanLine.match(/FORCE_CHARGE_WINDOWS_FOUND:\s*(\d+)/)
            if (match) {
              portalResult.forceChargingWindows = parseInt(match[1])
              debug('Found force charging windows count', { forceChargingWindows: portalResult.forceChargingWindows })
            } else if (cleanLine.includes('ERROR')) {
              debug('Error detected in force charging check')
              portalResult.forceChargingWindows = null
            }
          }
          
          // Also look for explicit current status value patterns from the Sunny Portal page
          // Based on the output: "PV power generation 6.88 kW" etc
          const pvMatch = cleanLine.match(/PV power generation.*?([0-9.]+)\s*kW/i)
          if (pvMatch && !portalResult.pvGeneration) {
            portalResult.pvGeneration = parseFloat(pvMatch[1]) * 1000 // Convert kW to W
            debug('Found PV generation from page text', { pvGeneration: portalResult.pvGeneration })
            powerValuesFound++
          }
          
          const consumptionMatch = cleanLine.match(/Total consumption.*?([0-9.]+)\s*kW/i)
          if (consumptionMatch && !portalResult.consumption) {
            portalResult.consumption = parseFloat(consumptionMatch[1]) * 1000 // Convert kW to W
            debug('Found consumption from page text', { consumption: portalResult.consumption })
            powerValuesFound++
          }
          
          const batteryMatch = cleanLine.match(/Battery charging.*?([0-9.]+)\s*kW/i)
          if (batteryMatch && !portalResult.batteryCharging) {
            portalResult.batteryCharging = parseFloat(batteryMatch[1]) * 1000 // Convert kW to W
            debug('Found battery charging from page text', { batteryCharging: portalResult.batteryCharging })
            powerValuesFound++
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
        
        // Check if we got sufficient power data from Sunny Portal
        if (powerValuesFound < 2 || (!portalResult.pvGeneration && !portalResult.consumption)) {
          debug('Insufficient power data from Sunny Portal - sending alert email')
          
          // Send alert email for Sunny Portal data failure
          Email.sendErrorEmail('Sunny Portal Data Collection Failed', 
            'Failed to retrieve sufficient current power values from Sunny Portal', 
            {
              script: 'getForecastData.test.js',
              operation: 'Getting current power values from Sunny Portal',
              extractedData: portalResult,
              powerValuesFound: powerValuesFound,
              stdoutLength: stdout.length,
              stderrLength: stderr.length,
              timestamp: new Date().toISOString(),
              severity: 'MEDIUM',
              impact: 'Current power values not available - display will show N/A for some values',
              troubleshooting: [
                'Check Sunny Portal credentials are correct',
                'Verify Sunny Portal URL: ' + (process.env.SUNNY_PORTAL_URL || 'https://www.sunnyportal.com/'),
                'Check if Sunny Portal website is accessible',
                'Verify OAuth authentication is working',
                'Check if Current Status page is loading properly',
                'Review page content extraction logic'
              ]
            }
          ).catch(emailError => {
            debug('Failed to send Sunny Portal alert email', { error: emailError.message })
          })
          
          console.log('⚠️ WARNING: Insufficient current power data from Sunny Portal')
        }
        
        return portalResult
        })
        
        // Check if we got sufficient power data from Sunny Portal
        const powerValuesCount = [
          sunnyPortalData.pvGeneration,
          sunnyPortalData.consumption,
          sunnyPortalData.purchasedElectricity,
          sunnyPortalData.batteryCharging
        ].filter(val => val !== null).length
        
        if (powerValuesCount >= 1) { // At least one power value is sufficient
          debug(`✅ Sunny Portal success on attempt ${attempt}`, { powerValues: powerValuesCount })
          break
        } else {
          throw new Error(`Insufficient power data from Sunny Portal on attempt ${attempt}`)
        }
        
      } catch (error) {
        debug(`❌ Sunny Portal attempt ${attempt} failed`, { error: error.message })
        
        if (attempt === maxPortalRetries) {
          // Final attempt failed - send alert email
          debug('All Sunny Portal attempts failed - sending alert')
          
          Email.sendErrorEmail('Sunny Portal Collection Critical Failure', 
            `Failed to get data from Sunny Portal after ${maxPortalRetries} attempts`, 
            {
              script: 'getForecastData.test.js',
              operation: 'Sunny Portal data collection with retries',
              error: error.message,
              stackTrace: error.stack,
              attempts: maxPortalRetries,
              timestamp: new Date().toISOString(),
              severity: 'HIGH',
              impact: 'No current power values or forecast data available',
              troubleshooting: [
                'Check internet connectivity',
                'Verify Sunny Portal website is accessible: ' + (process.env.SUNNY_PORTAL_URL || 'https://www.sunnyportal.com/'),
                'Check Sunny Portal credentials',
                'Verify username: ' + (process.env.SUNNY_PORTAL_USERNAME || 'not set'),
                'Check if Sunny Portal service is down',
                'Review network firewall settings',
                'Check Playwright browser configuration',
                'Consider increasing retry count or timeout values',
                'Review page content extraction logic'
              ]
            }
          ).catch(emailError => {
            debug('Failed to send Sunny Portal critical alert email', { error: emailError.message })
          })
          
          console.log(`❌ ERROR: Complete failure to access Sunny Portal after ${maxPortalRetries} attempts`)
          sunnyPortalData = { pvGeneration: null, consumption: null, purchasedElectricity: null, batteryCharging: null }
        } else {
          // Wait before retry
          console.log(`⚠️ Sunny Portal attempt ${attempt} failed, retrying in 10 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 10000))
        }
      }
    }
    
    debug('Step 3: Combining results from both data sources')
    // Combine the results - SOC from inverter, power values and force charging state from Sunny Portal
    // Use Portal force charging state if available, fallback to inverter charging state
    const portalForceCharging = sunnyPortalData.forceChargingWindows !== null ? sunnyPortalData.forceChargingWindows > 0 : null
    const finalChargingState = portalForceCharging !== null ? portalForceCharging : socData.isCharging
    
    debug('Charging state determination', {
      inverterCharging: socData.isCharging,
      portalWindowCount: sunnyPortalData.forceChargingWindows,
      portalForceCharging: portalForceCharging,
      finalChargingState: finalChargingState
    })
    
    data = {
      stateOfCharge: socData.stateOfCharge,
      isCharging: finalChargingState,
      capacity: socData.capacity,
      pvGeneration: sunnyPortalData.pvGeneration,
      consumption: sunnyPortalData.consumption,
      purchasedElectricity: sunnyPortalData.purchasedElectricity,
      batteryCharging: sunnyPortalData.batteryCharging,
      forceChargingWindows: sunnyPortalData.forceChargingWindows
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

// Check if force charging is currently configured by looking for time windows
// This is now integrated into the existing Sunny Portal data collection to avoid multiple logins
exports.isForceChargingConfigured = async function() {
  debug('Force charging state will be retrieved from existing Sunny Portal data collection')
  debug('This function should not be called directly - charging state is included in getAllInverterData')
  
  // This function is kept for backward compatibility but should not be used
  // The force charging detection is now integrated into the getForecastData.test.js
  console.log('⚠️ Warning: isForceChargingConfigured() called directly - this is now integrated into getAllInverterData()')
  return null
}