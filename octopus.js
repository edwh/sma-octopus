require('dotenv').config()

// Debug logging utility
const DEBUG = process.env.DEBUG === 'true'
function debug(message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString()
    if (data !== null) {
      console.log(`[DEBUG ${timestamp}] OCTOPUS: ${message}:`, data)
    } else {
      console.log(`[DEBUG ${timestamp}] OCTOPUS: ${message}`)
    }
  }
}

// Get configuration from environment variables
const CHEAP_PERCENTILE = process.env.CHEAP_PERCENTILE || 25
const MODERATE_PERCENTILE = process.env.MODERATE_PERCENTILE || 25
const CHEAP_THRESHOLD = process.env.CHEAP_THRESHOLD || 60
const CHEAP_DIFFERENCE = process.env.CHEAP_DIFFERENCE || 0.1
const MODERATE_THRESHOLD = process.env.MODERATE_THRESHOLD || 30

// Octopus Go configuration
const OCTOPUS_GO_ENABLED = process.env.OCTOPUS_GO_ENABLED === 'true'
const OCTOPUS_GO_START_TIME = process.env.OCTOPUS_GO_START_TIME || '00:30'
const OCTOPUS_GO_END_TIME = process.env.OCTOPUS_GO_END_TIME || '05:30'
const OCTOPUS_GO_RATE = parseFloat(process.env.OCTOPUS_GO_RATE) || 8.5
const CONSUMPTION_START_THRESHOLD = parseFloat(process.env.CONSUMPTION_START_THRESHOLD) || 3000
const CONSUMPTION_STOP_THRESHOLD = parseFloat(process.env.CONSUMPTION_STOP_THRESHOLD) || 6000
const OCTOPUS_GO_TARGET_SOC = parseFloat(process.env.OCTOPUS_GO_TARGET_SOC) || 40

// Helper function to check if current time is within Octopus Go window
function isWithinOctopusGoWindow(forceWindow = false) {
  debug('Checking if within Octopus Go window', { OCTOPUS_GO_ENABLED, forceWindow })
  if (!OCTOPUS_GO_ENABLED) {
    debug('Octopus Go not enabled')
    return false
  }
  
  if (forceWindow) {
    debug('Force window mode - overriding time check to return true')
    return true
  }
  
  const now = new Date()
  const currentTime = now.getHours() * 100 + now.getMinutes()
  debug('Current time calculation', { 
    now: now.toISOString(), 
    hours: now.getHours(), 
    minutes: now.getMinutes(), 
    currentTime 
  })
  
  // Parse start and end times (e.g., "00:30" becomes 30, "05:30" becomes 530)
  const [startHour, startMin] = OCTOPUS_GO_START_TIME.split(':').map(Number)
  const [endHour, endMin] = OCTOPUS_GO_END_TIME.split(':').map(Number)
  const startTime = startHour * 100 + startMin
  const endTime = endHour * 100 + endMin
  debug('Time window parsing', {
    OCTOPUS_GO_START_TIME,
    OCTOPUS_GO_END_TIME,
    startHour, startMin, startTime,
    endHour, endMin, endTime
  })
  
  let withinWindow
  // Handle time windows that cross midnight
  if (startTime > endTime) {
    withinWindow = currentTime >= startTime || currentTime <= endTime
    debug('Time window crosses midnight', { withinWindow })
  } else {
    withinWindow = currentTime >= startTime && currentTime <= endTime
    debug('Normal time window', { withinWindow })
  }
  
  debug('Time window check result', { withinWindow })
  return withinWindow
}

exports.getPrices = async function () {
  debug('Getting Octopus Agile prices')
  let ret = null
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  debug('Price query time range', { start, end })

  const url = 'https://api.octopus.energy/v1/products/AGILE-FLEX-22-11-25/electricity-tariffs/E-1R-AGILE-FLEX-22-11-25-C/standard-unit-rates/?' +
    'period_from=' + start + '&' +
    'period_to=' + end
  debug('Octopus API URL', url)

  debug('Fetching prices from Octopus API')
  const res = await fetch(url)
  debug('Octopus API response status', { ok: res.ok, status: res.status })

  if (res.ok) {
    data = await res.json()
    debug('Octopus API data received', { resultsCount: data?.results?.length })
  } else {
    debug('Octopus API request failed', { status: res.status, statusText: res.statusText })
  }

  return data
}

exports.shouldCharge = async function (stateOfCharge, currentConsumption = null, isCurrentlyCharging = false, forceWindow = false, forecastedGeneration = null) {
  debug('=== shouldCharge called ===')
  debug('Input parameters', { stateOfCharge, currentConsumption, isCurrentlyCharging, forceWindow, forecastedGeneration })
  let charge = false

  // If Octopus Go is enabled, use time-based charging
  if (OCTOPUS_GO_ENABLED) {
    debug('Octopus Go mode enabled - using time-based charging')
    const inTimeWindow = isWithinOctopusGoWindow(forceWindow)
    debug('Time window check result', inTimeWindow)
    
    if (!inTimeWindow) {
      debug('Outside Octopus Go window - rejecting charge')
      console.log('Outside Octopus Go window - not charging')
      return {
        shouldCharge: false,
        forecastData: {
          forecastedGeneration,
          adjustedTargetSOC: OCTOPUS_GO_TARGET_SOC,
          originalTargetSOC: OCTOPUS_GO_TARGET_SOC,
          forecastAdjustment: 0,
          currentConsumption
        }
      }
    }
    
    debug('Within Octopus Go window - checking SOC and consumption thresholds')
    console.log('Within Octopus Go window (', OCTOPUS_GO_START_TIME, '-', OCTOPUS_GO_END_TIME, ')')
    
    // Calculate adjusted target SOC based on forecasted generation
    let adjustedTargetSOC = OCTOPUS_GO_TARGET_SOC
    let forecastAdjustment = 0
    
    if (forecastedGeneration !== null && forecastedGeneration > 0) {
      // Convert forecasted kWh to percentage of battery capacity
      // We need to get battery capacity for this calculation
      // For now, we'll make a reasonable assumption or fallback
      const assumedBatteryCapacity = 31.2 // kWh - can be made configurable
      forecastAdjustment = (forecastedGeneration / assumedBatteryCapacity) * 100
      adjustedTargetSOC = OCTOPUS_GO_TARGET_SOC - forecastAdjustment
      
      // Ensure adjusted target doesn't go below 0
      adjustedTargetSOC = Math.max(0, adjustedTargetSOC)
      
      debug('Forecast-adjusted target SOC calculation', {
        originalTarget: OCTOPUS_GO_TARGET_SOC,
        forecastedGeneration,
        assumedBatteryCapacity,
        forecastAdjustment,
        adjustedTargetSOC
      })
      
      console.log('📈 Forecasted generation:', forecastedGeneration, 'kWh')
      console.log('🔄 Target SOC adjusted from', OCTOPUS_GO_TARGET_SOC, '% to', adjustedTargetSOC.toFixed(1), '% (reduction:', forecastAdjustment.toFixed(1), '%)')
    } else {
      debug('No forecast data available - using original target SOC')
      console.log('⚠️ No forecast data available - using original target SOC of', OCTOPUS_GO_TARGET_SOC, '%')
    }
    
    // Check if battery SOC is already at or above adjusted target
    if (stateOfCharge >= adjustedTargetSOC) {
      debug('Battery SOC at or above adjusted target - not charging', { 
        stateOfCharge, 
        adjustedTargetSOC, 
        originalTarget: OCTOPUS_GO_TARGET_SOC,
        forecastAdjustment 
      })
      console.log('🔋 Battery SOC (', stateOfCharge, '%) is at or above adjusted target (', adjustedTargetSOC.toFixed(1), '%) - not charging')
      if (forecastedGeneration > 0) {
        console.log('💡 Charging stopped early due to', forecastedGeneration, 'kWh expected solar generation today')
      }
      return {
        shouldCharge: false,
        forecastData: {
          forecastedGeneration,
          adjustedTargetSOC,
          originalTargetSOC: OCTOPUS_GO_TARGET_SOC,
          forecastAdjustment,
          currentConsumption
        }
      }
    }
    debug('Battery SOC below adjusted target - continuing with charging logic', { stateOfCharge, adjustedTargetSOC, originalTarget: OCTOPUS_GO_TARGET_SOC })
    
    // Check consumption thresholds if provided
    if (currentConsumption !== null) {
      debug('Consumption data available - checking thresholds', {
        currentConsumption,
        CONSUMPTION_START_THRESHOLD,
        CONSUMPTION_STOP_THRESHOLD,
        isCurrentlyCharging
      })
      
      if (!isCurrentlyCharging && currentConsumption > CONSUMPTION_START_THRESHOLD) {
        debug('Consumption exceeds start threshold - not starting charge')
        console.log('Current consumption (', currentConsumption, 'W) exceeds start threshold (', CONSUMPTION_START_THRESHOLD, 'W) - not starting charge')
        return {
          shouldCharge: false,
          forecastData: {
            forecastedGeneration,
            adjustedTargetSOC,
            originalTargetSOC: OCTOPUS_GO_TARGET_SOC,
            forecastAdjustment,
            currentConsumption
          }
        }
      } else if (isCurrentlyCharging && currentConsumption > CONSUMPTION_STOP_THRESHOLD) {
        debug('Consumption exceeds stop threshold - stopping charge')
        console.log('Current consumption (', currentConsumption, 'W) exceeds stop threshold (', CONSUMPTION_STOP_THRESHOLD, 'W) - stopping charge')
        return {
          shouldCharge: false,
          forecastData: {
            forecastedGeneration,
            adjustedTargetSOC,
            originalTargetSOC: OCTOPUS_GO_TARGET_SOC,
            forecastAdjustment,
            currentConsumption
          }
        }
      }
      debug('Consumption thresholds passed')
    } else {
      debug('No consumption data available - skipping consumption checks')
    }
    
    // Within time window, SOC below adjusted target, and consumption is acceptable - charge
    debug('All Octopus Go conditions met - approving charge', { 
      adjustedTargetSOC, 
      originalTarget: OCTOPUS_GO_TARGET_SOC, 
      forecastAdjustment 
    })
    if (forecastedGeneration > 0) {
      console.log('✅ Conditions met for Octopus Go charging - SOC:', stateOfCharge, '% (adjusted target:', adjustedTargetSOC.toFixed(1), '%, original:', OCTOPUS_GO_TARGET_SOC, '%), forecast:', forecastedGeneration, 'kWh, consumption:', currentConsumption || 'not checked', 'W, currently charging:', isCurrentlyCharging)
    } else {
      console.log('✅ Conditions met for Octopus Go charging - SOC:', stateOfCharge, '% (target:', OCTOPUS_GO_TARGET_SOC, '%), consumption:', currentConsumption || 'not checked', 'W, currently charging:', isCurrentlyCharging)
    }
    
    return {
      shouldCharge: true,
      forecastData: {
        forecastedGeneration,
        adjustedTargetSOC,
        originalTargetSOC: OCTOPUS_GO_TARGET_SOC,
        forecastAdjustment,
        currentConsumption
      }
    }
  }

  // Fallback to original Agile logic
  debug('Octopus Go disabled - falling back to Agile pricing logic')
  const prices = await exports.getPrices()
  debug('Prices retrieved for Agile logic')

  if (!prices || !prices.results) {
    debug('No price data available for Agile logic')
    console.log('No price data available')
    return {
      shouldCharge: false,
      forecastData: {
        forecastedGeneration,
        adjustedTargetSOC: OCTOPUS_GO_TARGET_SOC,
        originalTargetSOC: OCTOPUS_GO_TARGET_SOC,
        forecastAdjustment: 0,
        currentConsumption
      }
    }
  }

  // Find median price.
  prices.results.sort((a, b) => a.value_inc_vat - b.value_inc_vat)
  const median = prices.results[Math.floor(prices.results.length / 2)].value_inc_vat
  debug('Price analysis - median calculated', median)

  const cheap = prices.results[Math.floor(prices.results.length * CHEAP_PERCENTILE / 100)].value_inc_vat
  const moderate = prices.results[Math.floor(prices.results.length * MODERATE_PERCENTILE / 100)].value_inc_vat
  debug('Price thresholds calculated', { cheap, moderate })

  // Find the current price
  const now = new Date()
  const currentPriceEntry = prices.results.find(price => new Date(price.valid_from) <= now && new Date(price.valid_to) >= now)
  const current = currentPriceEntry?.value_inc_vat
  debug('Current price lookup', { now: now.toISOString(), current, currentPriceEntry })

  if (current) {
    debug('Evaluating Agile pricing conditions', {
      current, cheap, moderate, median,
      stateOfCharge, CHEAP_THRESHOLD, MODERATE_THRESHOLD,
      medianCheapDiff: median - cheap,
      requiredDiff: CHEAP_DIFFERENCE * median
    })
    
    if (current <= cheap && stateOfCharge <= CHEAP_THRESHOLD && median - cheap > CHEAP_DIFFERENCE * median) {
      // We have a cheap price and our battery isn't getting full so charge.
      debug('Agile condition met: cheap price + low SOC')
      console.log('Price is cheap (', current, 'vs', cheap, ', median ', median, ') and state of charge is low (', CHEAP_THRESHOLD, ') so charge.')
      charge = true
    } else if (current <= moderate && stateOfCharge <= MODERATE_THRESHOLD) {
      // We have a moderate price and our battery is getting empty so charge.
      debug('Agile condition met: moderate price + very low SOC')
      charge = true
      console.log('Price is moderate (', current, 'vs', moderate, ', median ', median, ') and state of charge is very low (', MODERATE_THRESHOLD, ') so charge.')
    } else {
      // It's an expensive period, so just pay the current price.
      debug('Agile conditions not met - price too high or SOC too high')
      console.log('Price is too high (', current, ', median ', median, ') or state of charge is too high (', stateOfCharge, ') so do not charge.')
    }
  } else {
    debug('No current price found in Agile data')
    console.log('No current price found.')
  }

  debug('Final Agile charging decision', charge)
  return {
    shouldCharge: charge,
    forecastData: {
      forecastedGeneration,
      adjustedTargetSOC: OCTOPUS_GO_TARGET_SOC,
      originalTargetSOC: OCTOPUS_GO_TARGET_SOC,
      forecastAdjustment: 0,
      currentConsumption
    }
  }
}