require('dotenv').config()
const {test, expect} = require('@playwright/test')
const {getForecastData, getCurrentStatusFromSunnyPortal, checkForceChargingFromSunnyPortal} = require('./utils')

test('Get forecast data from Sunny Portal', async ({page}) => {
  // Get forecast data first (this includes login)
  await getForecastData(page)
  
  // Then get current status values using the same logged-in session
  await getCurrentStatusFromSunnyPortal(page)
  
  // Finally check force charging windows using the same logged-in session
  await checkForceChargingFromSunnyPortal(page)
})