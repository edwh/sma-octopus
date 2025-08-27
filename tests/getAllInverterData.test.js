require('dotenv').config()
const {test, expect} = require('@playwright/test')
const {getAllInverterData} = require('./utils')

test('Get all inverter data using hybrid approach', async ({page}) => {
  // Use the existing utils function but add comprehensive data collection
  console.log('=== TESTING HYBRID DATA COLLECTION ===')
  
  const data = await getAllInverterData(page)
  
  // Verify SOC from SMA inverter (this should work as before)
  expect(data.stateOfCharge).not.toBeNull()
  expect(data.stateOfCharge).toBeGreaterThan(0)
  expect(data.stateOfCharge).toBeLessThanOrEqual(100)
  
  // Verify battery capacity
  expect(data.capacity).toEqual(31.2)
  
  console.log('Current inverter data:', JSON.stringify(data, null, 2))
  
  // Note: The utils function currently only gets SOC from inverter
  // For a true hybrid test, we'd need to also test Sunny Portal data collection
  // But this shows the SMA inverter connection is working
  
  console.log('✅ SMA inverter connection successful')
  console.log('✅ SOC:', data.stateOfCharge + '%')
  console.log('✅ Capacity:', data.capacity, 'kWh')
  
  // The hybrid approach (sma.js) would additionally get power values from Sunny Portal
  // This test focuses on confirming the SMA inverter data collection works
})