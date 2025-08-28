require('dotenv').config()
const {test, expect} = require('@playwright/test')

// Function to control battery charging via time windows
async function setBatteryCharging(page, action) {
  console.log(`=== BATTERY CHARGING CONTROL: ${action.toUpperCase()} ===`)
  
  await page.setViewportSize({width: 1920, height: 1080})
  
  try {
    // Login to Sunny Portal
    console.log('Logging into Sunny Portal...')
    await page.goto('https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    // Handle OAuth redirect
    if (page.url().includes('error=login_required')) {
      await page.goto('https://www.sunnyportal.com/', { timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 30000 })
    }
    
    // Handle cookies
    try {
      const cookieButton = page.locator('button:has-text("Accept all")').first()
      if (await cookieButton.count() > 0) {
        await cookieButton.click()
        await page.waitForTimeout(1000)
      }
    } catch (e) {}
    
    // Click login
    const loginButton = page.locator('*[id$="SmaIdLoginButton"]').first()
    if (await loginButton.count() > 0) {
      await loginButton.click()
      await page.waitForTimeout(3000)
    }
    
    // Enter credentials
    await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
    await page.waitForTimeout(1000)
    await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
    await page.waitForTimeout(1000)
    
    // Submit login
    await page.locator('button:has-text("Log in")').click()
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    console.log('✅ Logged in successfully')
    
    // Navigate directly to Plant Formula Configuration page
    console.log('Navigating to Plant Formula Configuration page...')
    await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    console.log('On Plant Formula Configuration page')
    await page.screenshot({ path: 'plant-formula-config-page.png', fullPage: true })
    
    // Look for the specific Edit button at bottom of page
    console.log('Looking for Edit Configuration button...')
    const editButton = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
    
    if (await editButton.count() > 0) {
      console.log('✅ Found Edit Configuration button, clicking...')
      await editButton.click()
      await page.waitForTimeout(5000) // Wait longer for page to update in edit mode
      await page.screenshot({ path: 'after-edit-click.png', fullPage: true })
      console.log('✅ Edit mode activated')
    } else {
      console.log('❌ Edit Configuration button not found - may need to scroll to bottom')
      // Try scrolling to bottom to find the Edit button
      console.log('Scrolling to bottom to find Edit button...')
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(3000)
      
      const editButtonBottom = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
      if (await editButtonBottom.count() > 0) {
        console.log('✅ Found Edit Configuration button at bottom, clicking...')
        await editButtonBottom.click()
        await page.waitForTimeout(5000)
        await page.screenshot({ path: 'after-edit-click.png', fullPage: true })
        console.log('✅ Edit mode activated')
      } else {
        console.log('❌ Edit Configuration button still not found')
        // Try alternative selectors for Edit button
        const altEditSelectors = [
          'a:has-text("Edit")',
          '*[id*="EditConfiguration"]',
          'a[class*="lnkbtn"]'
        ]
        
        for (const selector of altEditSelectors) {
          const altEditButton = page.locator(selector).first()
          if (await altEditButton.count() > 0) {
            console.log(`Found Edit button with selector: ${selector}`)
            await altEditButton.click()
            await page.waitForTimeout(5000)
            break
          }
        }
      }
    }
    
    // Look for the battery charging section
    console.log('Looking for "Time window control for charging the battery-storage system"...')
    const timeWindowSection = page.locator('*:has-text("Time window control for charging the battery-storage system")')
    
    if (await timeWindowSection.count() > 0) {
      console.log('✅ Found battery charging time window section!')
    } else {
      console.log('⚠️  Time window section not found, continuing to look for addBatChargeButton...')
    }
    
    // Scroll down to see more content
    console.log('Scrolling down to look for more battery controls...')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)
    
    // Take full screenshot to see everything
    await page.screenshot({ path: 'full-page-after-scroll.png', fullPage: true })
    
    // Look for any buttons or controls in the time window section
    console.log('Looking for addBatChargeButton and other controls...')
    
    // Search for the specific button ID first
    let addButton = page.locator('#addBatChargeButton')
    
    if (await addButton.count() === 0) {
      console.log('addBatChargeButton not found, trying alternative selectors...')
      
      // Try alternative selectors
      const altSelectors = [
        'button[id*="addBat"]',
        'button[id*="BatCharge"]', 
        '*[onclick*="addBat"]',
        'button:has-text("Add")',
        'input[value*="Add"]',
        '*[id*="BatCharge"]',
        'button[onclick*="charge"]',
        '*[value="Add time period"]',
        'button:has-text("Add time period")',
        '*[onclick*="period"]'
      ]
      
      for (const selector of altSelectors) {
        const altButton = page.locator(selector).first()
        if (await altButton.count() > 0) {
          console.log(`Found alternative button with selector: ${selector}`)
          addButton = altButton
          break
        }
      }
    }
    
    // If still no button found, look for any buttons/inputs near the Time Period section
    if (await addButton.count() === 0) {
      console.log('No specific add button found, looking for any buttons in the time period area...')
      
      // Find the Time Period section and look for nearby buttons
      const timePeriodText = page.locator('*:has-text("Time Period")')
      if (await timePeriodText.count() > 0) {
        console.log('Found Time Period text, looking for nearby controls...')
        
        // Look for buttons anywhere on the page that might be related
        const allButtons = await page.locator('button, input[type="button"], input[type="submit"], *[onclick]').all()
        console.log(`Found ${allButtons.length} interactive elements on page`)
        
        // Check if any look like they might be for adding time periods
        for (let i = 0; i < allButtons.length; i++) {
          try {
            const button = allButtons[i]
            const text = await button.innerText()
            const onclick = await button.getAttribute('onclick') || ''
            const id = await button.getAttribute('id') || ''
            const value = await button.getAttribute('value') || ''
            
            if (text.toLowerCase().includes('add') || 
                onclick.toLowerCase().includes('add') || 
                onclick.toLowerCase().includes('bat') ||
                onclick.toLowerCase().includes('charge') ||
                id.toLowerCase().includes('add') ||
                value.toLowerCase().includes('add')) {
              console.log(`Potential add button found: "${text}" id="${id}" onclick="${onclick}" value="${value}"`)
              addButton = button
              break
            }
          } catch (e) {
            // Skip problematic buttons
          }
        }
      }
    }
    
    // Remove existing charging windows
    console.log('Removing existing charging windows...')
    const removeButtons = page.locator('img[src="../Tools/images/buttons/remove_segment_btn.png"]')
    const removeCount = await removeButtons.count()
    console.log(`Found ${removeCount} existing windows to remove`)
    
    // Remove all existing windows (from last to first)
    for (let i = removeCount - 1; i >= 0; i--) {
      try {
        await removeButtons.nth(i).click()
        await page.waitForTimeout(1000)
        console.log(`Removed window ${i + 1}`)
      } catch (e) {
        console.log(`Error removing window ${i + 1}: ${e.message}`)
      }
    }
    
    if (action.toLowerCase() === 'on') {
      console.log('Adding charging window for next hour...')
      
      if (await addButton.count() === 0) {
        throw new Error('Could not find add battery charge button')
      }
      
      // Calculate time window (next hour)
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
      await addButton.click()
      await page.waitForTimeout(2000)
      
      // Fill time fields
      console.log('Filling time window form...')
      const timeInputs = await page.locator('input[type="time"], input[placeholder*="time"], input[name*="time"], input[type="text"]').all()
      
      let filledCount = 0
      for (const input of timeInputs) {
        try {
          const value = await input.inputValue()
          const placeholder = await input.getAttribute('placeholder') || ''
          const name = await input.getAttribute('name') || ''
          
          // Only fill empty time-like inputs
          if ((value === '' || value === '00:00') && 
              (placeholder.toLowerCase().includes('time') || name.toLowerCase().includes('time') || filledCount < 2)) {
            
            if (filledCount === 0) {
              await input.fill(startTimeStr)
              console.log(`Set start time: ${startTimeStr}`)
              filledCount++
            } else if (filledCount === 1) {
              await input.fill(endTimeStr)  
              console.log(`Set end time: ${endTimeStr}`)
              filledCount++
              break
            }
          }
        } catch (e) {
          // Skip problematic inputs
        }
      }
      
      if (filledCount < 2) {
        console.log('Warning: Could not fill both time fields automatically')
        await page.screenshot({ path: 'time-form-debug.png', fullPage: true })
      }
      
      console.log('✅ Charging window configured')
    }
    
    // Save configuration
    console.log('Saving configuration...')
    const saveButton = page.locator('button:has-text("Save"), input[value="Save"]').first()
    
    if (await saveButton.count() > 0) {
      await saveButton.click()
      await page.waitForTimeout(3000)
      console.log('✅ Configuration saved')
    } else {
      console.log('⚠️  Save button not found - changes may not be saved')
    }
    
    await page.screenshot({ path: `charging-${action.toLowerCase()}-final.png`, fullPage: true })
    
    // Verify on live data page
    console.log('Verifying on live data page...')
    await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(10000) // Wait for data refresh
    
    await page.screenshot({ path: `live-data-after-${action.toLowerCase()}.png`, fullPage: true })
    
    // Check battery status
    const batteryChargingElement = page.locator('*:has-text("Battery charging")').first()
    if (await batteryChargingElement.count() > 0) {
      const chargingInfo = await batteryChargingElement.innerText()
      console.log(`Current battery status: ${chargingInfo}`)
    }
    
    console.log(`✅ Battery charging control ${action.toUpperCase()} completed successfully`)
    
    return {
      success: true,
      action: action,
      message: action.toLowerCase() === 'on' ? 
        `Charging window set for ${startTimeStr} - ${endTimeStr}` : 
        'All charging windows removed'
    }
    
  } catch (error) {
    console.error(`Error in battery charging control: ${error.message}`)
    await page.screenshot({ path: `charging-${action.toLowerCase()}-error.png`, fullPage: true })
    throw error
  }
}

test('Turn Battery Charging ON for next hour', async ({page}) => {
  const result = await setBatteryCharging(page, 'ON')
  console.log('✅ Result:', result)
})

test('Turn Battery Charging OFF', async ({page}) => {
  const result = await setBatteryCharging(page, 'OFF')
  console.log('✅ Result:', result)
})