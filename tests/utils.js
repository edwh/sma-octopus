const {expect} = require('@playwright/test')

exports.setCharging = async function (page, val) {
  const maxRetries = 2
  let attempt = 0
  
  while (attempt <= maxRetries) {
    attempt++
    console.log(`Setting charging parameter attempt ${attempt}/${maxRetries + 1}`)
    
    try {
      console.log(`Navigating to inverter at ${process.env.inverterIP}...`)
      await page.goto('http://' + process.env.inverterIP + '/#/login', { timeout: 30000 })
      
      console.log('Logging in...')
      await page.selectOption('select[name="username"]', 'Installer', { timeout: 15000 })
      await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
      await page.click('#bLogin', { timeout: 15000 })
      
      // Wait for login to complete
      console.log('Waiting for login to complete...')
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      
      console.log('Navigating to Device Parameters...')
      await page.click('#lDeviceParameter', { timeout: 30000 })
      
      console.log('Clicking Parameter Edit...')
      await page.click('#bParameterEdit', { timeout: 20000 })
      
      const batterySection = page.locator('span', {
        hasText: 'Battery'
      }).first()
      await batterySection.click({ timeout: 15000 })
      
      const applicationSection = page.locator('span', {
        hasText: 'Areas of application'
      }).first()

      const selfConsumption = page.locator('td', {
        hasText: 'Minimum width of self-consumption area'
      })

      const selfConsumptionRow = await selfConsumption.locator('..').first()
      const selfConsumptionInput = await selfConsumptionRow.locator('input').first()

      // Set the value - low value forces battery to charge
      console.log(`Setting self-consumption parameter to: ${val}`)
      await selfConsumptionInput.fill(val)

      // Save the changes
      console.log('Saving changes...')
      await page.locator('button', {
        hasText: 'Save all'
      }).click({ timeout: 15000 })
      
      console.log('Parameter saved, waiting for save confirmation...')
      
      // Wait for save operation to complete
      console.log('Waiting for save operation to complete...')
      try {
        // Wait a bit for the save to process
        await page.waitForTimeout(5000)
      } catch (e) {
        // Continue regardless
      }
      
      // Navigate to fresh login page to verify the value was stored
      console.log('Navigating to fresh login page to verify parameter was stored...')
      await page.goto('http://' + process.env.inverterIP + '/#/login', { 
        waitUntil: 'load', 
        timeout: 45000 
      })
      
      // Re-login after navigation
      console.log('Re-logging in for verification...')
      await page.selectOption('select[name="username"]', 'Installer', { timeout: 15000 })
      await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
      await page.click('#bLogin', { timeout: 15000 })
      await page.waitForLoadState('networkidle', { timeout: 45000 })
      
      console.log('Navigating back to Device Parameters for verification...')
      await page.click('#lDeviceParameter', { timeout: 30000 })
      
      console.log('Clicking Parameter Edit for verification...')
      await page.click('#bParameterEdit', { timeout: 20000 })
      
      // Navigate back to the parameter
      console.log('Finding Battery section for verification...')
      const batterySection2 = page.locator('span', { hasText: 'Battery' }).first()
      await batterySection2.click({ timeout: 20000 })
      
      console.log('Looking for self-consumption parameter...')
      const selfConsumption2 = page.locator('td', { hasText: 'Minimum width of self-consumption area' })
      const selfConsumptionRow2 = selfConsumption2.locator('..').first()
      const selfConsumptionInput2 = selfConsumptionRow2.locator('input').first()
      
      // Check the stored value with timeout
      console.log('Reading stored parameter value...')
      const storedValue = await selfConsumptionInput2.inputValue({ timeout: 20000 })
      console.log(`Verification: Expected "${val}", Found "${storedValue}"`)
      
      if (storedValue === val) {
        console.log(`✅ Parameter successfully set and verified on attempt ${attempt}`)
        return page
      } else {
        console.log(`❌ Parameter verification failed on attempt ${attempt}: expected "${val}", got "${storedValue}"`)
        if (attempt > maxRetries) {
          throw new Error(`Failed to set parameter after ${maxRetries + 1} attempts. Expected "${val}", but stored value is "${storedValue}"`)
        }
        console.log(`Retrying after brief delay...`)
        // Brief delay before retry - using page interaction instead of waitForTimeout
        try {
          await page.waitForSelector('body', { timeout: 2000 })
        } catch (e) {
          // Timeout is expected, just used for delay
        }
      }
      
    } catch (error) {
      console.log(`❌ Error on attempt ${attempt}:`, error.message)
      if (attempt > maxRetries) {
        throw new Error(`Failed to set charging parameter after ${maxRetries + 1} attempts: ${error.message}`)
      }
      console.log(`Retrying after brief delay...`)
      // Brief delay before retry
      try {
        await page.waitForSelector('body', { timeout: 2000 })
      } catch (e) {
        // Timeout is expected, just used for delay
      }
    }
  }
  
  throw new Error(`Failed to set charging parameter after ${maxRetries + 1} attempts`)
}

exports.getStateOfCharge = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.click('#lSpotValues')
  const batterySection = await page.locator('span', {
    hasText: 'Battery'
  }).first()
  await batterySection.click()

  // Wait for section to expand - doesn't seem to work using normal Playwright waits.
  await page.waitForTimeout(5000)
  const socPercent = page.locator('td', {
    hasText: 'State of charge'
  })

  const socRow = await socPercent.locator('..').first()
  const socValue = await socRow.locator('.ng-scope').locator('nth=1').first()
  // await socValue.scrollIntoViewIfNeeded()
  let value = await socValue.innerText()
  value = value.replace(' ', '').replace('%', '')
  console.log('SOC', value)
  value = parseInt(value)

  expect(value).toBeGreaterThan(0)
  expect(value).toBeLessThan(100)

  return value
}

exports.getCurrentConsumption = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.click('#lSpotValues')
  
  // Look for consumption values - could be in various sections
  // Common patterns: "AC consumption", "Grid consumption", "Load", etc.
  
  // Wait for page to load
  await page.waitForTimeout(5000)
  
  // Try to find consumption in different possible locations
  const consumptionPatterns = [
    'AC power consumption',
    'Grid consumption', 
    'Load power',
    'Consumption',
    'AC load'
  ]
  
  let consumption = null
  
  for (const pattern of consumptionPatterns) {
    try {
      const consumptionElement = page.locator('td', { hasText: pattern }).first()
      if (await consumptionElement.count() > 0) {
        const consumptionRow = await consumptionElement.locator('..').first()
        const consumptionValue = await consumptionRow.locator('.ng-scope').locator('nth=1').first()
        
        let value = await consumptionValue.innerText()
        // Remove units (W, kW) and spaces, convert to watts
        value = value.replace(/\s/g, '').replace('W', '').replace('kW', '').replace(',', '.')
        
        if (value.includes('k')) {
          // Convert kW to W
          consumption = parseFloat(value.replace('k', '')) * 1000
        } else {
          consumption = parseFloat(value)
        }
        
        console.log('Consumption', consumption)
        break
      }
    } catch (e) {
      // Continue to next pattern
    }
  }
  
  if (consumption === null) {
    console.log('Could not find consumption data on page')
  }

  return consumption
}

exports.getBatteryCapacity = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.waitForTimeout(5000)
  
  let capacity = null
  
  try {
    // Navigate to Device Parameters where the actual rated capacity is stored
    await page.click('#lDeviceParameter')
    await page.waitForTimeout(3000)
    
    // Find and expand Battery section
    const batterySection = page.locator('span', { hasText: 'Battery' }).first()
    if (await batterySection.count() > 0) {
      await batterySection.click()
      await page.waitForTimeout(3000)
      
      // Look specifically for "Rated capacity" in the Battery parameters
      // From our exploration, we found: "Rated capacity	31,200 Wh"
      const pageContent = await page.textContent('body')
      
      // Search for the rated capacity line
      const lines = pageContent.split('\n')
      for (const line of lines) {
        if (line.includes('Rated capacity') && line.includes('Wh')) {
          // Extract the value: "Rated capacity	31,200 Wh" -> "31,200"
          const match = line.match(/Rated capacity\s+([0-9,]+)\s*Wh/)
          if (match) {
            const whValue = parseFloat(match[1].replace(',', ''))
            capacity = whValue / 1000  // Convert Wh to kWh
            console.log('Capacity found:', whValue, 'Wh =', capacity, 'kWh')
            break
          }
        }
      }
      
      if (capacity === null) {
        console.log('Could not find "Rated capacity" field in expected format')
        // Try alternative parsing - look for the table structure
        const tables = await page.locator('table').all()
        
        for (const table of tables) {
          const rows = await table.locator('tr').all()
          
          for (const row of rows) {
            try {
              const cells = await row.locator('td').all()
              if (cells.length >= 2) {
                const label = await cells[0].innerText()
                const value = await cells[1].innerText()
                
                if (label.trim() === 'Rated capacity' && value.includes('Wh')) {
                  // Extract numeric value from something like "31,200 Wh"
                  const whMatch = value.match(/([0-9,]+)\s*Wh/)
                  if (whMatch) {
                    const whValue = parseFloat(whMatch[1].replace(',', ''))
                    capacity = whValue / 1000  // Convert to kWh
                    console.log('Capacity found in table:', whValue, 'Wh =', capacity, 'kWh')
                    break
                  }
                }
              }
            } catch (e) {
              // Skip problematic rows
            }
          }
          if (capacity !== null) break
        }
      }
      
    } else {
      console.log('Battery section not found in Device Parameters')
    }
    
  } catch (e) {
    console.log('Error getting battery capacity:', e)
  }
  
  if (capacity === null) {
    console.log('Could not determine battery capacity from device parameters')
  }

  console.log('Capacity', capacity || 'unknown')
  return capacity
}

exports.getAllInverterData = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})
  
  const result = {
    stateOfCharge: null,
    consumption: null,
    capacity: null,
    isCharging: null
  }

  try {
    // Login once
    await page.goto('http://' + process.env.inverterIP + '/#/login')
    await page.selectOption('select[name="username"]', 'Installer')
    await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
    await page.click('#bLogin')
    await page.waitForTimeout(2000)

    // First get spot values (SOC, consumption, charging status)
    await page.click('#lSpotValues')
    await page.waitForTimeout(3000)
    
    // Expand Battery section
    const batterySection = await page.locator('span', { hasText: 'Battery' }).first()
    if (await batterySection.count() > 0) {
      await batterySection.click()
      await page.waitForTimeout(3000)
      
      // Get State of Charge
      try {
        const socPercent = page.locator('td', { hasText: 'State of charge' })
        if (await socPercent.count() > 0) {
          const socRow = await socPercent.locator('..').first()
          const socValue = await socRow.locator('.ng-scope').locator('nth=1').first()
          let value = await socValue.innerText()
          value = value.replace(/\s/g, '').replace('%', '')
          result.stateOfCharge = parseInt(value)
          console.log('SOC', result.stateOfCharge)
        }
      } catch (e) {
        console.log('Could not get SOC:', e.message)
      }
      
      // Get Battery Charging Status from Device Parameters (check actual control parameter)
      try {
        console.log('Getting charging status from Device Parameters...')
        // Navigate to Device Parameters to check the charging control setting
        await page.click('#lDeviceParameter')
        await page.waitForTimeout(5000)
        
        // Debug: see what sections are available
        const allSpans = await page.locator('span').all()
        const sectionTexts = []
        for (const span of allSpans) {
          try {
            const text = await span.innerText()
            if (text && text.length > 0 && text.length < 50) {
              sectionTexts.push(text.trim())
            }
          } catch (e) {
            // Skip
          }
        }
        console.log('Available sections:', sectionTexts.filter(t => t.includes('Battery') || t.includes('battery') || t.includes('Parameters') || t.includes('Application')))
        
        // Try different ways to find Battery section
        let batteryParamSection = page.locator('span', { hasText: 'Battery' }).first()
        if (await batteryParamSection.count() === 0) {
          batteryParamSection = page.locator('span', { hasText: 'battery' }).first()
        }
        if (await batteryParamSection.count() === 0) {
          batteryParamSection = page.locator('span').filter({ hasText: /[Bb]attery/ }).first()
        }
        
        console.log('Battery section count:', await batteryParamSection.count())
        
        if (await batteryParamSection.count() > 0) {
          await batteryParamSection.click()
          await page.waitForTimeout(2000)
          
          // Look for Areas of application section
          const applicationSection = page.locator('span', { hasText: 'Areas of application' }).first()
          if (await applicationSection.count() > 0) {
            
            // Find the self-consumption parameter that we control
            const selfConsumption = page.locator('td', { hasText: 'Minimum width of self-consumption area' })
            if (await selfConsumption.count() > 0) {
              const selfConsumptionRow = await selfConsumption.locator('..').first()
              const selfConsumptionInput = await selfConsumptionRow.locator('input').first()
              
              if (await selfConsumptionInput.count() > 0) {
                const currentValue = await selfConsumptionInput.inputValue()
                console.log('Self-consumption parameter value:', currentValue)
                
                // We set this to a low value (like "1") to force charging
                // Normal/high values (like "95") mean not charging
                const numValue = parseFloat(currentValue) || 95
                result.isCharging = numValue < 50  // Low value = charging enabled
                console.log('Charging status from parameter:', result.isCharging, '(value:', numValue, ')')
              }
            } else {
              console.log('Could not find self-consumption parameter')
            }
          } else {
            console.log('Could not find Areas of application section')
          }
        } else {
          console.log('Could not find Battery section in Device Parameters for charging status')
        }
        
        // Go back to Spot Values for other data
        await page.click('#lSpotValues')
        await page.waitForTimeout(2000)
        
      } catch (e) {
        console.log('Could not get charging status from parameters:', e.message)
        // Fallback: go back to Spot Values
        try {
          await page.click('#lSpotValues')
          await page.waitForTimeout(2000)
        } catch (fallbackError) {
          console.log('Could not return to Spot Values:', fallbackError.message)
        }
      }
    }
    
    // Get Current Consumption (could be in other sections)
    try {
      const consumptionPatterns = [
        'AC power consumption',
        'Grid consumption', 
        'Load power',
        'Consumption',
        'AC load'
      ]
      
      for (const pattern of consumptionPatterns) {
        try {
          const consumptionElement = page.locator('td', { hasText: pattern }).first()
          if (await consumptionElement.count() > 0) {
            const consumptionRow = await consumptionElement.locator('..').first()
            const consumptionValue = await consumptionRow.locator('.ng-scope').locator('nth=1').first()
            
            let value = await consumptionValue.innerText()
            value = value.replace(/\s/g, '').replace('W', '').replace('kW', '').replace(',', '.')
            
            if (value.includes('k')) {
              result.consumption = parseFloat(value.replace('k', '')) * 1000
            } else {
              result.consumption = parseFloat(value)
            }
            
            console.log('Consumption', result.consumption)
            break
          }
        } catch (e) {
          // Continue to next pattern
        }
      }
    } catch (e) {
      console.log('Could not get consumption:', e.message)
    }

    // Get Battery Capacity from Device Parameters (if not already there)
    try {
      // Check if we're already on Device Parameters, if not navigate there
      const currentUrl = page.url()
      if (!currentUrl.includes('DeviceParameter')) {
        console.log('Navigating to Device Parameters for capacity...')
        await page.click('#lDeviceParameter')
        await page.waitForTimeout(5000)
      } else {
        console.log('Already on Device Parameters page')
      }
      
      // Use same battery section finder as charging status
      let batterySection = page.locator('span', { hasText: 'Battery' }).first()
      if (await batterySection.count() === 0) {
        batterySection = page.locator('span').filter({ hasText: /[Bb]attery/ }).first()
      }
      
      console.log('Capacity - Battery section count:', await batterySection.count())
      if (await batterySection.count() > 0) {
        console.log('Found Battery section in Device Parameters')
        await batterySection.click()
        await page.waitForTimeout(3000)
        
        // Look for Rated capacity
        const pageContent = await page.textContent('body')
        console.log('Searching for Rated capacity in page content...')
        const lines = pageContent.split('\n')
        
        for (const line of lines) {
          if (line.includes('Rated capacity') && line.includes('Wh')) {
            console.log('Found Rated capacity line:', line)
            const match = line.match(/Rated capacity\s+([0-9,]+)\s*Wh/)
            if (match) {
              const whValue = parseFloat(match[1].replace(',', ''))
              result.capacity = whValue / 1000  // Convert Wh to kWh
              console.log('Capacity', result.capacity, 'kWh')
              break
            }
          }
        }
        
        // Fallback: try table parsing if text parsing failed
        if (result.capacity === null) {
          console.log('Text parsing failed, trying table parsing...')
          const tables = await page.locator('table').all()
          console.log('Found', tables.length, 'tables to search')
          
          for (const table of tables) {
            const rows = await table.locator('tr').all()
            
            for (const row of rows) {
              try {
                const cells = await row.locator('td').all()
                if (cells.length >= 2) {
                  const label = await cells[0].innerText()
                  const value = await cells[1].innerText()
                  
                  if (label.includes('capacity') && value.includes('Wh')) {
                    console.log('Found capacity candidate:', { label: label.trim(), value: value.trim() })
                  }
                  
                  if (label.trim() === 'Rated capacity' && value.includes('Wh')) {
                    const whMatch = value.match(/([0-9,]+)\s*Wh/)
                    if (whMatch) {
                      const whValue = parseFloat(whMatch[1].replace(',', ''))
                      result.capacity = whValue / 1000
                      console.log('Capacity found in table:', result.capacity, 'kWh')
                      break
                    }
                  }
                }
              } catch (e) {
                // Skip problematic rows
              }
            }
            if (result.capacity !== null) break
          }
        }
        
        if (result.capacity === null) {
          console.log('Could not find Rated capacity in Device Parameters')
          // Let's see what we do have in the Battery section
          const batteryContent = await page.textContent('.battery-section, .ng-scope')
          console.log('Battery section content sample:', batteryContent ? batteryContent.substring(0, 500) : 'No content')
        }
      } else {
        console.log('Battery section not found in Device Parameters')
      }
    } catch (e) {
      console.log('Error getting capacity:', e.message)
    }

  } catch (e) {
    console.log('Error in getAllInverterData:', e.message)
  }

  console.log('AllData', JSON.stringify(result, null, 2))
  return result
}