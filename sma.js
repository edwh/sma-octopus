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
  debug('Getting all inverter data in single session')
  let data = {
    stateOfCharge: null,
    consumption: null,
    capacity: null,
    isCharging: null
  }
  
  try {
    debug('Executing getAllInverterData.test.js via Playwright')
    const {stdout, stderr} = await exec('npx playwright test getAllInverterData.test.js')
    debug('Playwright unified test completed', {
      stdoutLength: stdout.length,
      stderrLength: stderr.length
    })
    
    // Parse all outputs from the unified script
    const lines = stdout.split('\n')
    debug('Parsing unified output lines', { lineCount: lines.length })
    
    for (const line of lines) {
      // Remove ANSI color codes for easier parsing
      const cleanLine = line.replace(/\x1B\[[0-9;]*[mK]/g, '').replace(/\x1A\x2K/g, '')
      
      if (cleanLine.includes('SOC ')) {
        const socMatch = cleanLine.match(/SOC\s+([0-9]+)/)
        if (socMatch) {
          data.stateOfCharge = parseInt(socMatch[1])
          debug('Found SOC in output', { line: cleanLine, stateOfCharge: data.stateOfCharge })
        }
      } else if (cleanLine.includes('Consumption ')) {
        const consumptionMatch = cleanLine.match(/Consumption\s+([0-9.]+)/)
        if (consumptionMatch) {
          data.consumption = parseFloat(consumptionMatch[1])
          debug('Found consumption in output', { line: cleanLine, consumption: data.consumption })
        }
      } else if (cleanLine.includes('Capacity ') && cleanLine.includes('kWh')) {
        const capacityMatch = cleanLine.match(/Capacity\s+([0-9.]+)\s+kWh/)
        if (capacityMatch) {
          data.capacity = parseFloat(capacityMatch[1])
          debug('Found capacity in output', { line: cleanLine, capacity: data.capacity })
        }
      } else if (cleanLine.includes('IsCharging:')) {
        const chargingMatch = cleanLine.match(/IsCharging:\s*(true|false)/)
        if (chargingMatch) {
          data.isCharging = chargingMatch[1] === 'true'
          debug('Found charging status in output', { line: cleanLine, isCharging: data.isCharging })
        }
      } else if (cleanLine.includes('AllData')) {
        // Try to parse JSON output
        try {
          const jsonMatch = cleanLine.match(/AllData\s+(.+)/)
          if (jsonMatch) {
            const parsedData = JSON.parse(jsonMatch[1])
            data = { ...data, ...parsedData }
            debug('Parsed JSON data', parsedData)
          }
        } catch (e) {
          debug('Failed to parse JSON data', { error: e.message, line: cleanLine })
        }
      }
    }
    
  } catch (e) {
    debug('Error executing unified inverter data test', e)
    console.log('Error getting unified inverter data', e)
    
    // Send error email with comprehensive details
    await Email.sendErrorEmail('Playwright Script Error', e.message, {
      script: 'getAllInverterData.test.js',
      operation: 'Getting all inverter data',
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
        OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED
      }
    })
  }

  debug('Final unified data result', data)
  console.log('Got unified data:', JSON.stringify(data, null, 2))
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