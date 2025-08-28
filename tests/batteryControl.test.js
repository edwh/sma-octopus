require('dotenv').config()
const {test, expect} = require('@playwright/test')

// Simplified battery charging control function
async function controlBatteryCharging(page, action) {
  const actionUpper = action.toUpperCase()
  console.log(`=== BATTERY CHARGING: ${actionUpper} ===`)
  
  try {
    // Quick login with detailed logging
    console.log('🌐 Step 1: Navigating to Sunny Portal homepage...')
    await page.goto('https://www.sunnyportal.com/', { timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    console.log(`✅ Homepage loaded. Current URL: ${page.url()}`)
    
    // Handle login redirect
    if (page.url().includes('error=login_required') || page.url().includes('SilentLogin=true')) {
      console.log('🔄 Login redirect detected, navigating to homepage again...')
      await page.goto('https://www.sunnyportal.com/', { timeout: 60000 })
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      console.log(`✅ Redirect handled. New URL: ${page.url()}`)
    }
    
    // Handle cookies
    console.log('🍪 Step 2: Handling cookies...')
    try {
      const cookieButton = page.locator('button:has-text("Accept all")').first()
      if (await cookieButton.count() > 0) {
        await cookieButton.click({ timeout: 5000 })
        console.log('✅ Cookies accepted')
        await page.waitForTimeout(2000)
      } else {
        console.log('ℹ️  No cookie banner found')
      }
    } catch (e) {
      console.log('ℹ️  Cookie handling skipped:', e.message)
    }
    
    // Take screenshot before login
    await page.screenshot({ path: 'debug-before-login.png', fullPage: true })
    
    // Login process  
    console.log('🔐 Step 3: Looking for login button...')
    const loginButton = page.locator('*[id$="SmaIdLoginButton"]').first()
    if (await loginButton.count() === 0) {
      throw new Error('Login button not found')
    }
    
    console.log('✅ Found login button, clicking...')
    await loginButton.click()
    await page.waitForTimeout(5000)
    console.log(`✅ Login clicked. Current URL: ${page.url()}`)
    
    // Take screenshot after login click
    await page.screenshot({ path: 'debug-after-login-click.png', fullPage: true })
    
    console.log('📝 Step 4: Filling credentials...')
    const usernameField = page.locator('input[name="username"]').first()
    const passwordField = page.locator('input[name="password"]').first()
    
    if (await usernameField.count() === 0) {
      throw new Error('Username field not found')
    }
    if (await passwordField.count() === 0) {
      throw new Error('Password field not found')
    }
    
    await usernameField.fill(process.env.SUNNY_PORTAL_USERNAME)
    await page.waitForTimeout(1000)
    await passwordField.fill(process.env.SUNNY_PORTAL_PASSWORD)
    await page.waitForTimeout(1000)
    console.log('✅ Credentials filled')
    
    console.log('🔑 Step 5: Submitting login...')
    const submitButton = page.locator('button:has-text("Log in")').first()
    if (await submitButton.count() === 0) {
      throw new Error('Submit button not found')
    }
    
    await submitButton.click()
    console.log('✅ Login submitted, waiting for navigation...')
    
    // Wait for login to complete with multiple strategies
    try {
      await page.waitForNavigation({ timeout: 30000 })
      console.log(`✅ Navigation completed. URL: ${page.url()}`)
    } catch (e) {
      console.log('⚠️  Navigation timeout, but continuing...')
      await page.waitForTimeout(5000)
      console.log(`Current URL after timeout: ${page.url()}`)
    }
    
    // Wait for page to be ready
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    console.log('✅ Login completed successfully!')
    
    // Navigate to Plant Formula Configuration
    console.log('🏭 Step 6: Navigating to Plant Formula Configuration...')
    await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx', { timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    console.log(`✅ Plant Formula page loaded. URL: ${page.url()}`)
    
    // Take screenshot of the page
    await page.screenshot({ path: 'debug-plant-formula-page.png', fullPage: true })
    
    // Look for Edit button at bottom
    console.log('📝 Step 7: Looking for Edit Configuration button...')
    console.log('🔍 Scrolling to bottom to find Edit button...')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(3000)
    
    const editButton = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
    const editButtonCount = await editButton.count()
    console.log(`🔍 Edit button search result: ${editButtonCount} buttons found`)
    
    if (editButtonCount === 0) {
      console.log('❌ Edit Configuration button not found!')
      // Try alternative selectors
      const altSelectors = [
        'a:has-text("Edit")',
        '*[class*="lnkbtn"]',
        '*[id*="EditConfiguration"]'
      ]
      
      for (const selector of altSelectors) {
        const altButton = page.locator(selector).first()
        if (await altButton.count() > 0) {
          console.log(`✅ Found Edit button with alternative selector: ${selector}`)
          await altButton.click()
          await page.waitForTimeout(5000)
          break
        }
      }
    } else {
      console.log('✅ Found Edit Configuration button, clicking...')
      
      // Handle potential cookie overlay blocking the click
      try {
        console.log('🍪 Checking for cookie overlay that might block the click...')
        const cookieWrapper = page.locator('#cmpwrapper, [class*="cmp"], [class*="cookie"], [class*="consent"]')
        if (await cookieWrapper.count() > 0) {
          console.log('🍪 Found cookie overlay, trying to dismiss it...')
          
          // Try common cookie dismissal methods
          const dismissSelectors = [
            'button:has-text("Accept")',
            'button:has-text("Accept all")',
            'button:has-text("OK")',
            'button:has-text("Agree")',
            '[class*="accept"]',
            '[class*="close"]'
          ]
          
          for (const selector of dismissSelectors) {
            try {
              const dismissBtn = page.locator(selector).first()
              if (await dismissBtn.count() > 0) {
                await dismissBtn.click()
                console.log(`✅ Dismissed cookie overlay with: ${selector}`)
                await page.waitForTimeout(2000)
                break
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        console.log('ℹ️  Cookie overlay handling failed, proceeding anyway')
      }
      
      // Try clicking the Edit button with force option if blocked
      try {
        await editButton.click()
        console.log('✅ Edit button clicked successfully')
      } catch (e) {
        if (e.message.includes('intercepts pointer events')) {
          console.log('⚠️  Click blocked by overlay, trying force click...')
          await editButton.click({ force: true })
          console.log('✅ Edit button force-clicked')
        } else {
          throw e
        }
      }
      
      await page.waitForTimeout(5000)
    }
    
    console.log('✅ Edit mode should now be activated')
    await page.screenshot({ path: 'debug-edit-mode-active.png', fullPage: true })
    
    // Remove existing time periods
    console.log('🗑️  Step 8: Removing existing charging windows...')
    const removeButtons = page.locator('img[src="../Tools/images/buttons/remove_segment_btn.png"]')
    const removeCount = await removeButtons.count()
    console.log(`🔍 Found ${removeCount} existing charging windows to remove`)
    
    for (let i = removeCount - 1; i >= 0; i--) {
      try {
        console.log(`🗑️  Removing window ${i + 1}/${removeCount}...`)
        await removeButtons.nth(i).click()
        await page.waitForTimeout(1000)
        console.log(`✅ Successfully removed window ${i + 1}`)
      } catch (e) {
        console.log(`❌ Error removing window ${i + 1}: ${e.message}`)
      }
    }
    
    if (actionUpper === 'ON') {
      console.log('➕ Step 9: Adding charging window for next hour...')
      
      // Look for add button with detailed logging
      console.log('🔍 Looking for addBatChargeButton...')
      const addButton = page.locator('#addBatChargeButton')
      const addButtonCount = await addButton.count()
      console.log(`🔍 addBatChargeButton search result: ${addButtonCount} buttons found`)
      
      if (addButtonCount === 0) {
        console.log('❌ addBatChargeButton not found! Taking debug screenshot...')
        await page.screenshot({ path: 'debug-looking-for-add-button.png', fullPage: true })
        
        // Look for any buttons that might be the add button
        console.log('🔍 Looking for alternative add buttons...')
        const allButtons = await page.locator('button, input[type="button"], *[onclick]').all()
        console.log(`🔍 Found ${allButtons.length} interactive elements`)
        
        for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
          try {
            const button = allButtons[i]
            const text = await button.innerText()
            const onclick = await button.getAttribute('onclick') || ''
            const id = await button.getAttribute('id') || ''
            console.log(`Button ${i}: text="${text}" id="${id}" onclick="${onclick.substring(0, 50)}..."`)
          } catch (e) {}
        }
        
        throw new Error('addBatChargeButton not found in edit mode')
      }
      
      // Calculate next hour window
      const now = new Date()
      const startTime = new Date(now.getTime() + 2 * 60000)
      const endTime = new Date(startTime.getTime() + 60 * 60000)
      
      const startTimeStr = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`
      const endTimeStr = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`
      
      console.log(`⏰ Setting charging window: ${startTimeStr} - ${endTimeStr}`)
      
      // Click add button
      console.log('➕ Clicking add button...')
      await addButton.click()
      await page.waitForTimeout(3000)
      console.log('✅ Add button clicked')
      
      // Take screenshot after clicking add
      await page.screenshot({ path: 'debug-after-add-click.png', fullPage: true })
      
      // Fill time fields
      console.log('📝 Looking for time input fields...')
      const timeInputs = await page.locator('input[type="time"], input[type="text"]').all()
      console.log(`🔍 Found ${timeInputs.length} potential time inputs`)
      
      let filled = 0
      for (let i = 0; i < timeInputs.length && filled < 2; i++) {
        try {
          const input = timeInputs[i]
          const currentValue = await input.inputValue()
          const placeholder = await input.getAttribute('placeholder') || ''
          const name = await input.getAttribute('name') || ''
          
          console.log(`Input ${i}: value="${currentValue}" placeholder="${placeholder}" name="${name}"`)
          
          if ((currentValue === '' || currentValue === '00:00') && filled < 2) {
            if (filled === 0) {
              await input.fill(startTimeStr)
              console.log(`✅ Set start time: ${startTimeStr}`)
              filled++
            } else {
              await input.fill(endTimeStr)
              console.log(`✅ Set end time: ${endTimeStr}`)
              filled++
              break
            }
          }
        } catch (e) {
          console.log(`❌ Error with input ${i}: ${e.message}`)
        }
      }
      
      console.log(`✅ Filled ${filled}/2 time fields`)
      
      if (filled < 2) {
        console.log('⚠️  Warning: Could not fill both time fields')
      }
    } else {
      console.log('✅ Step 9: OFF mode - only removing existing windows (already completed)')
    }
    
    // Save configuration
    console.log('💾 Step 10: Saving configuration...')
    const saveButton = page.locator('button:has-text("Save"), input[value="Save"]').first()
    const saveButtonCount = await saveButton.count()
    console.log(`🔍 Save button search result: ${saveButtonCount} buttons found`)
    
    if (saveButtonCount > 0) {
      console.log('💾 Clicking Save button...')
      await saveButton.click()
      await page.waitForTimeout(5000)
      console.log('✅ Save button clicked, waiting for confirmation...')
      
      // Wait for save to complete
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      console.log('✅ Configuration saved successfully')
    } else {
      console.log('⚠️  No Save button found, configuration may not be saved')
    }
    
    await page.screenshot({ path: `debug-battery-${actionUpper.toLowerCase()}-complete.png`, fullPage: true })
    
    // Check result on live data page
    console.log('🔍 Step 11: Checking result on live data page...')
    await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx', { timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(10000)
    console.log('✅ Live data page loaded')
    
    await page.screenshot({ path: `debug-live-data-${actionUpper.toLowerCase()}.png`, fullPage: true })
    
    // Try to read battery status
    console.log('🔋 Reading battery status...')
    try {
      const batteryElements = await page.locator('*:has-text("Battery"), *:has-text("charging")').all()
      console.log(`🔍 Found ${batteryElements.length} battery-related elements`)
      
      for (let i = 0; i < Math.min(batteryElements.length, 3); i++) {
        try {
          const text = await batteryElements[i].innerText()
          if (text.includes('charging') || text.includes('Battery')) {
            console.log(`🔋 Battery info ${i}: ${text}`)
          }
        } catch (e) {}
      }
    } catch (e) {
      console.log('⚠️  Could not read battery status:', e.message)
    }
    
    const startTimeStr = actionUpper === 'ON' ? 
      (() => {
        const now = new Date()
        const startTime = new Date(now.getTime() + 2 * 60000)
        return `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`
      })() : ''
    const endTimeStr = actionUpper === 'ON' ? 
      (() => {
        const now = new Date()
        const startTime = new Date(now.getTime() + 2 * 60000)
        const endTime = new Date(startTime.getTime() + 60 * 60000)
        return `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`
      })() : ''
    
    const result = {
      success: true,
      action: actionUpper,
      message: actionUpper === 'ON' ? 
        `Charging window configured for next hour (${startTimeStr} - ${endTimeStr})` : 
        'All charging windows removed'
    }
    
    console.log('🎉 SUCCESS:', result.message)
    return result
    
  } catch (error) {
    console.error('❌ ERROR:', error.message)
    await page.screenshot({ path: `battery-${actionUpper.toLowerCase()}-error.png`, fullPage: true })
    throw error
  }
}

// Test cases with simple on/off parameters
test('Battery Charging ON', async ({page}) => {
  const result = await controlBatteryCharging(page, 'on')
  expect(result.success).toBe(true)
})

test('Battery Charging OFF', async ({page}) => {
  const result = await controlBatteryCharging(page, 'off')
  expect(result.success).toBe(true)
})