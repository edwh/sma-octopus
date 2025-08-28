require('dotenv').config()
const {test, expect} = require('@playwright/test')

// Function to manage Sunny Portal battery charging windows
async function manageBatteryCharging(page, action) {
  console.log(`=== SUNNY PORTAL BATTERY CHARGE CONTROL: ${action.toUpperCase()} ===`)
  
  await page.setViewportSize({width: 1920, height: 1080})
  
  try {
    console.log('Navigating to Sunny Portal...')
    await page.goto(process.env.SUNNY_PORTAL_URL || 'https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    // Handle login process (similar to existing forecast code)
    console.log('Handling login...')
    
    const currentUrl = page.url()
    console.log('Current URL after navigation:', currentUrl)
    
    // Handle redirects and OAuth flow
    if (currentUrl.includes('error=login_required') || currentUrl.includes('SilentLogin=true')) {
      console.log('Login required, navigating to homepage...')
      await page.goto('https://www.sunnyportal.com/', { timeout: 30000, waitUntil: 'load' })
      await page.waitForLoadState('networkidle', { timeout: 30000 })
    }
    
    await page.waitForTimeout(3000)
    
    // Handle cookie consent
    try {
      const cookieSelectors = [
        'button:has-text("Accept all")',
        'button:has-text("Accept")', 
        'button:has-text("OK")',
        '#cookie-accept',
        '.cookie-accept'
      ]
      
      for (const selector of cookieSelectors) {
        try {
          const cookieButton = page.locator(selector)
          if (await cookieButton.count() > 0) {
            console.log(`Accepting cookies with: ${selector}`)
            await cookieButton.click()
            await page.waitForTimeout(1000)
            break
          }
        } catch (e) {
          // Continue
        }
      }
    } catch (e) {
      console.log('Cookie consent handling:', e.message)
    }
    
    // Look for login button
    console.log('Looking for login button...')
    const loginSelectors = [
      '*[id$="SmaIdLoginButton"]',
      '*[id*="SmaIdLoginButton"]',
      'a:has-text("Login")',
      'button:has-text("Login")',
      'input[value="Login"]'
    ]
    
    let loginButton = null
    for (const selector of loginSelectors) {
      try {
        loginButton = page.locator(selector)
        if (await loginButton.count() > 0) {
          console.log(`Found login button: ${selector}`)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (loginButton) {
      console.log('Clicking login button...')
      try {
        await Promise.all([
          page.waitForNavigation({ timeout: 30000 }),
          loginButton.click()
        ])
      } catch (e) {
        await loginButton.click()
        await page.waitForTimeout(5000)
      }
    }
    
    // Fill login credentials
    console.log('Looking for login form...')
    const usernameSelectors = [
      'input[name="username"]',
      'input[name="email"]', 
      'input[type="email"]',
      'input[id="username"]',
      'input[placeholder*="Email"]',
      'input[placeholder*="Username"]'
    ]
    
    let usernameInput = null
    for (const selector of usernameSelectors) {
      try {
        usernameInput = page.locator(selector)
        if (await usernameInput.count() > 0) {
          console.log(`Found username field: ${selector}`)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (!usernameInput) {
      throw new Error('Could not find username input field')
    }
    
    console.log('Filling credentials...')
    await usernameInput.fill(process.env.SUNNY_PORTAL_USERNAME)
    await page.waitForTimeout(1000)
    
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[placeholder*="Password"]'
    ]
    
    let passwordInput = null
    for (const selector of passwordSelectors) {
      try {
        passwordInput = page.locator(selector)
        if (await passwordInput.count() > 0) {
          console.log(`Found password field: ${selector}`)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (!passwordInput) {
      throw new Error('Could not find password input field')
    }
    
    await passwordInput.fill(process.env.SUNNY_PORTAL_PASSWORD)
    await page.waitForTimeout(1000)
    
    // Submit login
    const loginButtonSelectors = [
      'button:has-text("Log in")',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign in")'
    ]
    
    let submitButton = null
    for (const selector of loginButtonSelectors) {
      try {
        submitButton = page.locator(selector)
        if (await submitButton.count() > 0) {
          console.log(`Found submit button: ${selector}`)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (submitButton) {
      console.log('Submitting login...')
      try {
        await Promise.all([
          page.waitForNavigation({ timeout: 30000 }),
          submitButton.click()
        ])
      } catch (e) {
        await submitButton.click()
        await page.waitForTimeout(5000)
      }
    }
    
    // Wait for login to complete
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    console.log('Login completed, current URL:', page.url())
    
    // Navigate to Plant Formula Configuration page
    console.log('Navigating to Plant Formula Configuration...')
    await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx', { 
      timeout: 30000, 
      waitUntil: 'load' 
    })
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    console.log('On Plant Formula Configuration page')
    await page.screenshot({ path: 'plant-formula-page.png', fullPage: true })
    
    // Look for and click Edit button
    console.log('Looking for Edit button...')
    const editSelectors = [
      'button:has-text("Edit")',
      'input[value="Edit"]',
      '*[onclick*="edit"]',
      '.edit-button',
      '#edit-button'
    ]
    
    let editButton = null
    for (const selector of editSelectors) {
      try {
        editButton = page.locator(selector)
        if (await editButton.count() > 0) {
          console.log(`Found Edit button: ${selector}`)
          await editButton.click()
          await page.waitForTimeout(3000)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (!editButton || await editButton.count() === 0) {
      console.log('Edit button not found, taking screenshot for debugging...')
      await page.screenshot({ path: 'plant-formula-no-edit.png', fullPage: true })
      throw new Error('Could not find Edit button')
    }
    
    console.log('Edit mode activated')
    await page.screenshot({ path: 'plant-formula-edit-mode.png', fullPage: true })
    
    // Look for the battery charging section
    console.log('Looking for "Time window control for charging the battery-storage system" section...')
    
    // Wait for the section to be visible
    await page.waitForTimeout(3000)
    
    const sectionText = 'Time window control for charging the battery-storage system'
    const section = page.locator(`*:has-text("${sectionText}")`)
    
    if (await section.count() === 0) {
      // Try partial matches
      const partialMatches = [
        'Time window control',
        'battery-storage system',
        'charging the battery',
        'Time window'
      ]
      
      for (const partial of partialMatches) {
        const partialSection = page.locator(`*:has-text("${partial}")`)
        if (await partialSection.count() > 0) {
          console.log(`Found partial match: "${partial}"`)
          break
        }
      }
      
      console.log('Battery charging section not found, taking screenshot...')
      await page.screenshot({ path: 'plant-formula-no-section.png', fullPage: true })
      
      // List all text content to help identify the section
      const allText = await page.textContent('body')
      const lines = allText.split('\n').filter(line => line.trim().length > 0)
      console.log('Available text content (first 20 lines):')
      lines.slice(0, 20).forEach((line, idx) => {
        console.log(`${idx + 1}: ${line.trim()}`)
      })
      
      throw new Error('Could not find battery charging time window section')
    }
    
    console.log('Found battery charging section')
    
    // Remove all existing charging windows
    console.log('Removing all existing charging windows...')
    const removeButtons = page.locator('img[src="../Tools/images/buttons/remove_segment_btn.png"]')
    const removeCount = await removeButtons.count()
    console.log(`Found ${removeCount} existing charging windows to remove`)
    
    // Remove from last to first to avoid index issues
    for (let i = removeCount - 1; i >= 0; i--) {
      try {
        const removeBtn = removeButtons.nth(i)
        await removeBtn.click()
        await page.waitForTimeout(1000)
        console.log(`Removed charging window ${i + 1}`)
      } catch (e) {
        console.log(`Error removing window ${i + 1}:`, e.message)
      }
    }
    
    if (action.toLowerCase() === 'on') {
      console.log('Adding new charging window for next hour...')
      
      // Calculate next hour time window
      const now = new Date()
      const startTime = new Date(now.getTime() + 2 * 60000) // Start in 2 minutes
      const endTime = new Date(startTime.getTime() + 60 * 60000) // End 1 hour later
      
      const formatTime = (date) => {
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        return `${hours}:${minutes}`
      }
      
      const startTimeStr = formatTime(startTime)
      const endTimeStr = formatTime(endTime)
      
      console.log(`Setting charging window: ${startTimeStr} - ${endTimeStr}`)
      
      // Click add button
      const addButton = page.locator('#addBatChargeButton')
      if (await addButton.count() === 0) {
        console.log('Add button with ID not found, trying alternative selectors...')
        const altSelectors = [
          'button[id*="addBat"]',
          '*[onclick*="addBat"]',
          'button:has-text("Add")',
          '*[src*="add"]'
        ]
        
        let foundAddButton = false
        for (const selector of altSelectors) {
          try {
            const altButton = page.locator(selector)
            if (await altButton.count() > 0) {
              console.log(`Found add button with: ${selector}`)
              await altButton.click()
              foundAddButton = true
              break
            }
          } catch (e) {
            // Continue
          }
        }
        
        if (!foundAddButton) {
          throw new Error('Could not find add battery charge button')
        }
      } else {
        await addButton.click()
      }
      
      await page.waitForTimeout(2000)
      
      // Fill in the time window (this will depend on the exact form structure)
      console.log('Filling time window form...')
      
      // Look for time input fields (may need adjustment based on actual form)
      const timeInputs = await page.locator('input[type="time"], input[placeholder*="time"], input[name*="time"]').all()
      
      if (timeInputs.length >= 2) {
        console.log('Found time input fields, filling start and end times...')
        await timeInputs[0].fill(startTimeStr)
        await timeInputs[1].fill(endTimeStr)
      } else {
        // Try text inputs with time patterns
        const allInputs = await page.locator('input[type="text"]').all()
        console.log(`Found ${allInputs.length} text inputs, looking for time fields...`)
        
        // Fill first two that look like time fields
        let filledInputs = 0
        for (const input of allInputs) {
          try {
            const placeholder = await input.getAttribute('placeholder') || ''
            const name = await input.getAttribute('name') || ''
            const id = await input.getAttribute('id') || ''
            
            if ((placeholder + name + id).toLowerCase().includes('time') && filledInputs < 2) {
              if (filledInputs === 0) {
                await input.fill(startTimeStr)
                console.log(`Filled start time: ${startTimeStr}`)
              } else {
                await input.fill(endTimeStr)
                console.log(`Filled end time: ${endTimeStr}`)
              }
              filledInputs++
            }
          } catch (e) {
            // Skip problematic inputs
          }
        }
        
        if (filledInputs < 2) {
          console.log('Could not find time input fields automatically, taking screenshot for manual review')
          await page.screenshot({ path: 'charging-window-form.png', fullPage: true })
        }
      }
      
      console.log('Charging window configured')
    } else {
      console.log('Action is OFF - all charging windows removed, no new ones added')
    }
    
    // Save the configuration
    console.log('Saving configuration...')
    const saveSelectors = [
      'button:has-text("Save")',
      'input[value="Save"]',
      '*[onclick*="save"]',
      '.save-button',
      '#save-button'
    ]
    
    let saveButton = null
    for (const selector of saveSelectors) {
      try {
        saveButton = page.locator(selector)
        if (await saveButton.count() > 0) {
          console.log(`Found Save button: ${selector}`)
          await saveButton.click()
          await page.waitForTimeout(3000)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (!saveButton || await saveButton.count() === 0) {
      console.log('Save button not found, taking screenshot...')
      await page.screenshot({ path: 'plant-formula-no-save.png', fullPage: true })
      console.log('⚠️  Could not find Save button - configuration may not be saved')
    } else {
      console.log('✅ Configuration saved')
    }
    
    await page.screenshot({ path: 'plant-formula-final.png', fullPage: true })
    
    // Wait a bit for changes to propagate
    await page.waitForTimeout(5000)
    
    // Navigate to live data page to check if charging starts
    console.log('Navigating to live data page to verify charging...')
    await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx', { 
      timeout: 30000, 
      waitUntil: 'load' 
    })
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    await page.waitForTimeout(10000) // Wait for data to load
    
    await page.screenshot({ path: 'live-data-after-config.png', fullPage: true })
    console.log('📸 Live data screenshot saved - check for charging indicators')
    
    // Look for charging indicators
    const pageContent = await page.textContent('body')
    const chargingIndicators = [
      'charging', 'Charging', 'CHARGING',
      'charge', 'Charge', 'CHARGE',
      'battery', 'Battery', 'BATTERY'
    ]
    
    console.log('\nLooking for charging indicators in live data...')
    for (const indicator of chargingIndicators) {
      if (pageContent.includes(indicator)) {
        console.log(`✅ Found indicator: "${indicator}"`)
      }
    }
    
    console.log(`\n=== BATTERY CHARGE CONTROL COMPLETE: ${action.toUpperCase()} ===`)
    
    return {
      success: true,
      action: action,
      message: action.toLowerCase() === 'on' ? 
        'Charging window configured for next hour' : 
        'All charging windows removed'
    }
    
  } catch (error) {
    console.error('Error in battery charge control:', error.message)
    await page.screenshot({ path: 'charge-control-error.png', fullPage: true })
    throw error
  }
}

test('Turn Battery Charging ON via Sunny Portal', async ({page}) => {
  const result = await manageBatteryCharging(page, 'ON')
  console.log('Result:', result)
})

test('Turn Battery Charging OFF via Sunny Portal', async ({page}) => {
  const result = await manageBatteryCharging(page, 'OFF')  
  console.log('Result:', result)
})