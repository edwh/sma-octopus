#!/usr/bin/env node

require('dotenv').config()
const SMA = require('./sma.js')
const Octopus = require('./octopus.js')

async function showForecast() {
  console.log('🔋 SMA Octopus Charging Forecast')
  console.log('================================\n')
  
  try {
    // Get current inverter data
    console.log('📊 Getting current system status...')
    const inverterData = await SMA.getAllInverterData()
    const { 
      stateOfCharge, 
      consumption: currentConsumption, 
      isCharging: currentChargingState,
      pvGeneration,
      purchasedElectricity,
      batteryCharging
    } = inverterData
    
    // Get forecast data
    console.log('🌞 Getting solar forecast from Sunny Portal...')
    const forecastedGeneration = await SMA.getForecastedGeneration()
    
    // Get charging decision
    console.log('🤖 Calculating charging decision...\n')
    const chargeDecision = await Octopus.shouldCharge(stateOfCharge, currentConsumption, currentChargingState, false, forecastedGeneration)
    const { shouldCharge, forecastData } = chargeDecision
    
    // Display results
    console.log('=== CURRENT STATUS ===')
    console.log(`☀️ PV power generation: ${pvGeneration !== null && pvGeneration !== undefined ? (pvGeneration / 1000).toFixed(2) + ' kW' : 'N/A'}`)
    console.log(`⚡ Total consumption: ${currentConsumption !== null && currentConsumption !== undefined ? (currentConsumption / 1000).toFixed(2) + ' kW' : 'N/A'}`)
    console.log(`🏠 Purchased electricity: ${purchasedElectricity !== null && purchasedElectricity !== undefined ? (purchasedElectricity / 1000).toFixed(2) + ' kW' : 'N/A'}`)
    console.log(`🔋 Battery charging: ${batteryCharging !== null && batteryCharging !== undefined ? (batteryCharging / 1000).toFixed(2) + ' kW' : 'N/A'}`)
    console.log(`🔋 Battery state of charge: ${stateOfCharge}%`)
    console.log(`🔌 Forced charging: ${currentChargingState ? 'Yes' : 'No'}`)
    
    // Show Octopus Go window status first
    console.log('\n=== OCTOPUS GO STATUS ===')
    const now = new Date()
    const localTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0')
    const gmtTime = now.getUTCHours().toString().padStart(2, '0') + ':' + now.getUTCMinutes().toString().padStart(2, '0')
    const startTime = process.env.OCTOPUS_GO_START_TIME || '00:30'
    const endTime = process.env.OCTOPUS_GO_END_TIME || '05:30'
    
    console.log(`⏰ Current time: ${localTime} (local), ${gmtTime} (GMT)`)
    console.log(`🕐 Octopus Go window: ${startTime} - ${endTime} (GMT)`)
    console.log(`🪟 Currently in window: ${isWithinWindow() ? '✅ YES' : '❌ NO'}`)
    
    console.log('\n=== SOLAR FORECAST ===')
    if (forecastedGeneration > 0) {
      console.log(`☀️ Expected generation today: ${forecastedGeneration} kWh`)
      
      // Show multiplier if it's not 100%
      const forecastMultiplier = parseFloat(process.env.SUNNY_PORTAL_FORECAST_MULTIPLIER || '100')
      if (forecastMultiplier !== 100) {
        console.log(`🔧 Forecast adjustment: ${forecastMultiplier}% applied`)
      }
    } else {
      console.log(`⚠️ No forecast data available`)
    }
    
    console.log('\n=== CHARGING DECISION ===')
    console.log(`🎯 Original target SOC for end-of-day: ${forecastData.originalTargetSOC}%`)
    if (forecastData.adjustedTargetSOC !== forecastData.originalTargetSOC) {
      console.log(`🎯 Adjusted target SOC: ${forecastData.adjustedTargetSOC.toFixed(1)}%`)
    }
    console.log(`⚡ Should force charge: ${shouldCharge ? '✅ YES' : '❌ NO'}`)
    console.log(`📈 Forecast impact: Reduces target SOC by ${forecastData.forecastAdjustment.toFixed(1)}%`)
    
    // Add explanation if forecast adjustment is 0 but there is forecast data
    if (forecastedGeneration > 0 && forecastData.forecastAdjustment === 0 && stateOfCharge >= forecastData.originalTargetSOC) {
      console.log(`💡 Note: No target reduction needed as battery SOC (${stateOfCharge}%) is already above original target (${forecastData.originalTargetSOC}%)`)
    }
    
    if (forecastedGeneration > 0 && !shouldCharge && stateOfCharge < forecastData.originalTargetSOC) {
      const savedPercentage = forecastData.originalTargetSOC - forecastData.adjustedTargetSOC
      const batteryCapacity = 31.2 // kWh
      const savedkWh = (savedPercentage / 100) * batteryCapacity
      const octopusGoRate = parseFloat(process.env.OCTOPUS_GO_RATE) || 8.5
      const savedCost = savedkWh * (octopusGoRate / 100)
      
      console.log(`💰 Estimated savings from forecast: ${savedkWh.toFixed(2)} kWh (£${savedCost.toFixed(2)})`)
      console.log(`💡 Reason: ${forecastedGeneration} kWh solar expected, so reduced charging needed`)
    }
    
  } catch (error) {
    console.error('❌ Error getting forecast:', error.message)
    process.exit(1)
  }
}

function isWithinWindow() {
  // Use GMT time since Octopus Go times are always GMT
  const now = new Date()
  const currentTime = now.getUTCHours() * 100 + now.getUTCMinutes()
  
  const startTime = process.env.OCTOPUS_GO_START_TIME || '00:30'
  const endTime = process.env.OCTOPUS_GO_END_TIME || '05:30'
  
  const [startHour, startMin] = startTime.split(':').map(Number)
  const [endHour, endMin] = endTime.split(':').map(Number)
  
  const start = startHour * 100 + startMin
  const end = endHour * 100 + endMin
  
  if (start <= end) {
    return currentTime >= start && currentTime <= end
  } else {
    return currentTime >= start || currentTime <= end
  }
}

// Run the forecast display
showForecast().catch(console.error)