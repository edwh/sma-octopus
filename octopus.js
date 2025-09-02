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
// Parse monthly CSV targets - format: Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec
const MORNING_TARGETS_CSV = process.env.OCTOPUS_GO_MORNING_TARGET_SOC || '45,45,45,30,30,30,30,30,30,45,45,45'
const EVENING_TARGETS_CSV = process.env.OCTOPUS_GO_EVENING_TARGET_SOC || '60,60,60,55,55,55,55,55,55,60,60,60'

const MONTHLY_MORNING_TARGETS = MORNING_TARGETS_CSV.split(',').map(v => parseFloat(v.trim()))
const MONTHLY_EVENING_TARGETS = EVENING_TARGETS_CSV.split(',').map(v => parseFloat(v.trim()))

// Function to get current month's targets
function getCurrentMonthTargets() {
  const currentMonth = new Date().getMonth() // 0-11 (Jan=0, Dec=11)
  
  const morningTarget = MONTHLY_MORNING_TARGETS[currentMonth] || 30
  const eveningTarget = MONTHLY_EVENING_TARGETS[currentMonth] || 55
  
  debug('Monthly target selection', {
    month: currentMonth + 1, // Display as 1-12
    monthName: new Date().toLocaleString('default', { month: 'long' }),
    morningTarget,
    eveningTarget,
    allMorningTargets: MONTHLY_MORNING_TARGETS,
    allEveningTargets: MONTHLY_EVENING_TARGETS
  })
  
  return { morningTarget, eveningTarget }
}


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
  
  // Get current time in GMT (UTC) since Octopus Go times are always GMT
  const now = new Date()
  const gmtHours = now.getUTCHours()
  const gmtMinutes = now.getUTCMinutes()
  const currentTime = gmtHours * 100 + gmtMinutes
  debug('Current time calculation (GMT)', { 
    now: now.toISOString(),
    localTime: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    gmtTime: `${gmtHours.toString().padStart(2, '0')}:${gmtMinutes.toString().padStart(2, '0')}`,
    gmtHours, 
    gmtMinutes, 
    currentTime 
  })
  
  // Parse start and end times (e.g., "00:30" becomes 30, "05:30" becomes 530)
  const [startHour, startMin] = OCTOPUS_GO_START_TIME.split(':').map(Number)
  const [endHour, endMin] = OCTOPUS_GO_END_TIME.split(':').map(Number)
  const startTime = startHour * 100 + startMin
  const endTime = endHour * 100 + endMin
  debug('Time window parsing (all times in GMT)', {
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

exports.isWithinOctopusGoWindow = isWithinOctopusGoWindow

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
    
    // Get current month's targets
    const { morningTarget, eveningTarget } = getCurrentMonthTargets()
    
    if (!inTimeWindow) {
      debug('Outside Octopus Go window - rejecting charge')
      console.log('Outside Octopus Go window - not charging')
      
      return {
        shouldCharge: false,
        forecastData: {
          forecastedGeneration,
          adjustedTargetSOC: eveningTarget,
          originalTargetSOC: eveningTarget,
          forecastAdjustment: 0,
          currentConsumption,
          morningTarget,
          eveningTarget
        }
      }
    }
    
    // Additional safeguard: Don't start charging if too close to tariff end (within 10 minutes)
    const now = new Date()
    const gmtHours = now.getUTCHours()
    const gmtMinutes = now.getUTCMinutes()
    const currentTime = gmtHours * 100 + gmtMinutes
    
    const [endHour, endMin] = OCTOPUS_GO_END_TIME.split(':').map(Number)
    const endTime = endHour * 100 + endMin
    const timeUntilEnd = (endTime - currentTime + 2400) % 2400 // Handle midnight wraparound
    
    if (timeUntilEnd <= 10 && timeUntilEnd > 0) { // Within 10 minutes of end
      debug('Too close to Octopus Go end time - rejecting charge to avoid overrun')
      console.log(`⚠️ Too close to tariff end (${OCTOPUS_GO_END_TIME} GMT) - not starting charge to avoid overrun`)
      
      return {
        shouldCharge: false,
        forecastData: {
          forecastedGeneration,
          adjustedTargetSOC: eveningTarget,
          originalTargetSOC: eveningTarget,
          forecastAdjustment: 0,
          currentConsumption,
          morningTarget,
          eveningTarget,
          rationale: `Too close to Octopus Go end time (${OCTOPUS_GO_END_TIME} GMT). Only ${timeUntilEnd} minutes remaining - insufficient time for charging cycle.`
        }
      }
    }
    
    debug('Within Octopus Go window - checking SOC and consumption thresholds')
    console.log('Within Octopus Go window (', OCTOPUS_GO_START_TIME, '-', OCTOPUS_GO_END_TIME, ')')
    
    // During Octopus Go window, determine target needed for upcoming periods
    // We need to charge enough for both morning use and evening (considering forecast)
    
    // Calculate evening target with forecast adjustment
    let eveningTargetAdjusted = eveningTarget
    let forecastAdjustment = 0
    
    if (forecastedGeneration !== null && forecastedGeneration > 0) {
      const assumedBatteryCapacity = 31.2 // kWh - can be made configurable
      forecastAdjustment = (forecastedGeneration / assumedBatteryCapacity) * 100
      eveningTargetAdjusted = eveningTarget - forecastAdjustment
      
      // Evening target shouldn't go below morning target
      eveningTargetAdjusted = Math.max(morningTarget, eveningTargetAdjusted)
      
      const monthName = new Date().toLocaleString('default', { month: 'long' })
      debug('Evening target with forecast adjustment', {
        month: monthName,
        baseEveningTarget: eveningTarget,
        forecastedGeneration,
        assumedBatteryCapacity,
        forecastAdjustment,
        eveningTargetAdjusted,
        morningTargetFloor: morningTarget
      })
      
      console.log('📅', monthName, 'charging targets')
      console.log('📈 Forecasted generation:', forecastedGeneration, 'kWh')
      console.log('🌙 Evening target adjusted from', eveningTarget, '% to', eveningTargetAdjusted.toFixed(1), '% (reduction:', forecastAdjustment.toFixed(1), '%, minimum:', morningTarget, '%)')
    } else {
      const monthName = new Date().toLocaleString('default', { month: 'long' })
      debug('No forecast data - using base evening target', { month: monthName })
      console.log('📅', monthName, 'charging targets')
      console.log('⚠️ No forecast data - using base evening target of', eveningTarget, '%')
    }
    
    // Use the higher of morning target and adjusted evening target
    const adjustedTargetSOC = Math.max(morningTarget, eveningTargetAdjusted)
    
    debug('Final target calculation during Octopus Go window', {
      morningTarget,
      eveningTargetAdjusted,
      finalTarget: adjustedTargetSOC
    })
    
    console.log('🎯 Charging targets: Morning', morningTarget, '%, Evening', eveningTargetAdjusted.toFixed(1), '% → Using', adjustedTargetSOC.toFixed(1), '%')
    
    // Check if battery SOC is already at or above adjusted target
    if (stateOfCharge >= adjustedTargetSOC) {
      debug('Battery SOC at or above adjusted target - not charging', { 
        stateOfCharge, 
        adjustedTargetSOC, 
        morningTarget: morningTarget,
        eveningTargetAdjusted,
        forecastAdjustment
      })
      console.log('🔋 Battery SOC (', stateOfCharge, '%) is at or above target (', adjustedTargetSOC.toFixed(1), '%) - not charging')
      if (forecastedGeneration > 0) {
        console.log('💡 Target optimized due to', forecastedGeneration, 'kWh expected solar generation today')
      }
      return {
        shouldCharge: false,
        forecastData: {
          forecastedGeneration,
          adjustedTargetSOC,
          originalTargetSOC: eveningTarget,
          forecastAdjustment,
          currentConsumption,
          morningTarget,
          eveningTarget,
          eveningTargetAdjusted,
          rationale: `Battery SOC (${stateOfCharge}%) exceeds target (${adjustedTargetSOC.toFixed(1)}%). Monthly targets for ${new Date().toLocaleString('default', { month: 'long' })}: Morning ${morningTarget}%, Evening ${eveningTarget}%${forecastedGeneration > 0 ? `, adjusted to ${eveningTargetAdjusted.toFixed(1)}% due to ${forecastedGeneration} kWh forecast` : ''}.`
        }
      }
    }
    debug('Battery SOC below adjusted target - continuing with charging logic', { stateOfCharge, adjustedTargetSOC, morningTarget, eveningTargetAdjusted })
    
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
            originalTargetSOC: eveningTarget,
            forecastAdjustment,
            currentConsumption,
            morningTarget,
            eveningTarget,
            eveningTargetAdjusted,
            rationale: `Consumption (${currentConsumption}W) exceeds start threshold (${CONSUMPTION_START_THRESHOLD}W). Would charge to ${adjustedTargetSOC.toFixed(1)}% (monthly targets for ${new Date().toLocaleString('default', { month: 'long' })}: Morning ${morningTarget}%, Evening ${eveningTarget}%${forecastedGeneration > 0 ? `, adjusted ${eveningTargetAdjusted.toFixed(1)}%` : ''}) but consumption too high to start.`
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
            originalTargetSOC: eveningTarget,
            forecastAdjustment,
            currentConsumption,
            morningTarget,
            eveningTarget,
            eveningTargetAdjusted,
            rationale: `Consumption (${currentConsumption}W) exceeds stop threshold (${CONSUMPTION_STOP_THRESHOLD}W). Was charging to ${adjustedTargetSOC.toFixed(1)}% (monthly targets for ${new Date().toLocaleString('default', { month: 'long' })}: Morning ${morningTarget}%, Evening ${eveningTarget}%${forecastedGeneration > 0 ? `, adjusted ${eveningTargetAdjusted.toFixed(1)}%` : ''}) but consumption too high to continue.`
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
      morningTarget,
      eveningTargetAdjusted, 
      forecastAdjustment 
    })
    if (forecastedGeneration > 0) {
      console.log('✅ Conditions met for Octopus Go charging - SOC:', stateOfCharge, '% (target:', adjustedTargetSOC.toFixed(1), '%, morning:', morningTarget, '%, evening:', eveningTargetAdjusted.toFixed(1), '%), forecast:', forecastedGeneration, 'kWh, consumption:', currentConsumption || 'not checked', 'W, currently charging:', isCurrentlyCharging)
    } else {
      console.log('✅ Conditions met for Octopus Go charging - SOC:', stateOfCharge, '% (target:', adjustedTargetSOC.toFixed(1), '%, morning:', morningTarget, '%, evening:', eveningTarget, '%), consumption:', currentConsumption || 'not checked', 'W, currently charging:', isCurrentlyCharging)
    }
    
    return {
      shouldCharge: true,
      forecastData: {
        forecastedGeneration,
        adjustedTargetSOC,
        originalTargetSOC: eveningTarget,
        forecastAdjustment,
        currentConsumption,
        morningTarget,
        eveningTarget,
        eveningTargetAdjusted,
        rationale: `Charging approved to ${adjustedTargetSOC.toFixed(1)}% (SOC: ${stateOfCharge}%). Monthly targets for ${new Date().toLocaleString('default', { month: 'long' })}: Morning ${morningTarget}%, Evening ${eveningTarget}%${forecastedGeneration > 0 ? ` (adjusted to ${eveningTargetAdjusted.toFixed(1)}% with ${forecastedGeneration} kWh forecast, saving ${forecastAdjustment.toFixed(1)}% charge)` : ''}. Consumption: ${currentConsumption || 'not checked'}W.`
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