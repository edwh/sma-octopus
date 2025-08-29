require('dotenv').config()
const {test, expect} = require('@playwright/test')
const {getForecastData, getCurrentStatusFromSunnyPortal, checkForceChargingFromSunnyPortal, getBatteryCapacityFromSunnyPortal, getStateOfChargeFromSunnyPortal} = require('./utils')

test('Get forecast data from Sunny Portal', async ({page}) => {
  console.log('🔄 Starting Sunny Portal data collection...')
  
  // Get forecast data first (this includes login)
  console.log('📊 Step 1/5: Getting forecast data and logging in...')
  await getForecastData(page)
  console.log('✅ Step 1/5: Forecast data complete')
  
  // Get SOC from Sunny Portal using the same logged-in session  
  console.log('🔋 Step 2/5: Getting battery SOC...')
  const soc = await getStateOfChargeFromSunnyPortal(page)
  console.log('SOC_FROM_SUNNY_PORTAL:', soc)
  console.log('✅ Step 2/5: SOC data complete')
  
  // Get battery capacity from Sunny Portal using the same logged-in session
  console.log('📏 Step 3/5: Getting battery capacity...')
  const capacity = await getBatteryCapacityFromSunnyPortal(page)
  console.log('CAPACITY_FROM_SUNNY_PORTAL:', capacity)
  console.log('✅ Step 3/5: Capacity data complete')
  
  // Then get current status values using the same logged-in session
  console.log('⚡ Step 4/5: Getting current power status...')
  await getCurrentStatusFromSunnyPortal(page)
  console.log('✅ Step 4/5: Power status complete')
  
  // Finally check force charging windows using the same logged-in session
  console.log('🕐 Step 5/5: Checking force charging windows...')
  await checkForceChargingFromSunnyPortal(page)
  console.log('✅ Step 5/5: Force charging check complete')
  console.log('🎉 All Sunny Portal data collection complete!')
})