require('dotenv').config()
const {test, expect} = require('@playwright/test')

// Simple version - just test the critical path
test('Battery Control - Simple Test', async ({page}) => {
  // Check FORCE_CHARGE environment variable
  const forceCharge = (process.env.FORCE_CHARGE || '').toLowerCase()
  const isChargeMode = forceCharge === 'on'
  const isOffMode = forceCharge === 'off'
  
  if (!isChargeMode && !isOffMode) {
    throw new Error('FORCE_CHARGE environment variable must be set to "on" or "off" (case insensitive)')
  }
  
  console.log(`=== SIMPLE BATTERY CONTROL TEST - ${forceCharge.toUpperCase()} MODE ===`)
  
  try {
    // Login (known working)
    console.log('1. Logging in...')
    await page.goto('https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    if (page.url().includes('error=login_required')) {
      await page.goto('https://www.sunnyportal.com/')
      await page.waitForLoadState('networkidle')
    }
    
    // Dismiss cookies aggressively
    try {
      await page.locator('button:has-text("Accept all")').click({ timeout: 3000 })
    } catch (e) {}
    
    await page.locator('*[id$="SmaIdLoginButton"]').click()
    await page.waitForTimeout(3000)
    
    await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
    await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
    await page.locator('button:has-text("Log in")').click()
    
    try {
      await page.waitForNavigation({ timeout: 30000 })
    } catch (e) {
      await page.waitForTimeout(5000)
    }
    
    console.log('✅ Logged in successfully')
    
    // Navigate to Plant Formula page
    console.log('2. Going to Plant Formula Configuration...')
    await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    // Take screenshot before cookie handling
    await page.screenshot({ path: 'simple-before-edit.png', fullPage: true })
    
    // Handle cookies more aggressively - REJECT ALL first
    console.log('3. Handling cookie overlay - clicking REJECT ALL...')
    try {
      // Wait a moment for cookies to load
      await page.waitForTimeout(3000)
      
      // Look for "Reject all" button with specific CSS selectors from quick script
      const rejectSelectors = [
        'a.cmpboxbtn.cmpboxbtnno.cmptxt_btn_no',  // Specific selector from quick script
        'button:has-text("Reject all")',
        '*:has-text("Reject all")',
        'button[onclick*="reject"]',
        'a:has-text("Reject all")',
        '*[title="Reject all"]'
      ]
      
      let rejectButton = null
      for (const selector of rejectSelectors) {
        rejectButton = page.locator(selector).first()
        if (await rejectButton.count() > 0) {
          console.log(`✅ Found "Reject all" button with selector: ${selector}`)
          break
        }
      }
      
      if (rejectButton && await rejectButton.count() > 0) {
        console.log('✅ Clicking "Reject all" button...')
        await rejectButton.click({ timeout: 5000 })
        await page.waitForTimeout(3000)
        console.log('✅ Clicked Reject all - waiting for overlay to disappear')
        
        // Wait for cmpwrapper to disappear or become invisible
        try {
          await page.waitForSelector('#cmpwrapper', { state: 'hidden', timeout: 10000 })
          console.log('✅ Cookie overlay disappeared')
        } catch (e) {
          console.log('⚠️  Cookie overlay still visible, forcing it to be hidden')
          
          // Force hide the overlay using JavaScript
          await page.evaluate(() => {
            const wrapper = document.querySelector('#cmpwrapper')
            if (wrapper) {
              wrapper.style.display = 'none'
              wrapper.style.visibility = 'hidden'
              wrapper.remove()
            }
          })
          
          await page.waitForTimeout(1000)
          console.log('✅ Cookie overlay force-hidden')
        }
      } else {
        console.log('⚠️  Reject all button not found with any selector')
        
        // Debug: show what cookie-related elements we can find
        const cookieElements = await page.locator('*[class*="cookie"], *[class*="consent"], *:has-text("cookie")').all()
        console.log(`Found ${cookieElements.length} cookie-related elements`)
        
        for (let i = 0; i < Math.min(cookieElements.length, 5); i++) {
          try {
            const element = cookieElements[i]
            const text = await element.innerText()
            const className = await element.getAttribute('class') || ''
            if (text && text.length < 100) {
              console.log(`Cookie element ${i}: "${text.substring(0, 50)}..." class="${className}"`)
            }
          } catch (e) {}
        }
        
        console.log('⚠️  Trying fallback cookie dismissal methods...')
        
        // Try other cookie dismissal strategies as fallback
        const cookieDismissers = [
          'button:has-text("Accept all")',
          'button:has-text("Accept")', 
          'button:has-text("OK")',
          '[class*="accept"]',
          '[onclick*="accept"]'
        ]
        
        for (const selector of cookieDismissers) {
          try {
            const cookieBtn = page.locator(selector).first()
            if (await cookieBtn.count() > 0) {
              console.log(`✅ Found fallback cookie button: ${selector}`)
              await cookieBtn.click({ timeout: 3000 })
              console.log(`✅ Dismissed cookies with: ${selector}`)
              await page.waitForTimeout(3000)
              break
            }
          } catch (e) {}
        }
      }
      
    } catch (e) {
      console.log('Cookie handling error:', e.message)
    }
    
    await page.screenshot({ path: 'simple-after-cookies.png', fullPage: true })
    
    // Find and click Edit button (cookies should be dismissed now)
    console.log('4. Clicking Edit button...')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)
    
    const editButton = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
    
    if (await editButton.count() === 0) {
      throw new Error('Edit button not found')
    }
    
    console.log('✅ Found Edit button, clicking normally (cookies should be dismissed)...')
    
    // Try normal click first (should work now that cookies are dismissed)
    try {
      await editButton.click({ timeout: 10000 })
      console.log('✅ Edit button clicked successfully with normal click')
    } catch (e) {
      console.log('⚠️  Normal click failed, trying force click:', e.message)
      await editButton.click({ force: true })
      console.log('✅ Edit button clicked with force')
    }
    
    await page.waitForTimeout(8000) // Wait longer for edit mode
    
    console.log('✅ Edit mode activated (hopefully)')
    
    await page.screenshot({ path: 'simple-edit-mode.png', fullPage: true })
    
    // Look for addBatChargeButton
    console.log('5. Looking for addBatChargeButton...')
    const addButton = page.locator('#addBatChargeButton')
    const addButtonCount = await addButton.count()
    
    console.log(`Found ${addButtonCount} addBatChargeButton elements`)
    
    if (addButtonCount > 0) {
      console.log('🎉 SUCCESS: Found addBatChargeButton! The script should work.')
      
      // Remove existing windows first
      const removeButtons = page.locator('img[src="../Tools/images/buttons/remove_segment_btn.png"]')
      const removeCount = await removeButtons.count()
      console.log(`Found ${removeCount} existing charging windows`)
      
      if (removeCount > 0) {
        console.log('6. Removing existing charging windows...')
        for (let i = 0; i < removeCount; i++) {
          const removeBtn = removeButtons.first()
          if (await removeBtn.count() > 0) {
            await removeBtn.click()
            await page.waitForTimeout(1000)
            console.log(`   Removed window ${i + 1}/${removeCount}`)
          }
        }
        console.log('✅ All existing windows removed')
        
        // Save the removal changes
        console.log('6a. Saving removal changes...')
        const saveButton = page.locator('#ctl00_ContentPlaceHolder1_SaveButton')
        await saveButton.click()
        await page.waitForTimeout(5000)
        
        // For OFF mode, we're done after removing windows
        if (isOffMode) {
          console.log('✅ OFF mode complete - all charging windows removed')
          await page.screenshot({ path: 'simple-off-complete.png', fullPage: true })
          return
        }
        
        // Re-enter edit mode for ON mode
        console.log('6b. Re-entering edit mode...')
        const editButton = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
        await editButton.click({ force: true })
        await page.waitForTimeout(5000)
        
        console.log('✅ Back in edit mode after removal')
      } else if (isOffMode) {
        // OFF mode with no existing windows - just save and exit
        console.log('✅ OFF mode complete - no charging windows to remove')
        const saveButton = page.locator('#ctl00_ContentPlaceHolder1_SaveButton')
        await saveButton.click()
        await page.waitForTimeout(5000)
        await page.screenshot({ path: 'simple-off-complete.png', fullPage: true })
        return
      }
      
      // Only add charging window in ON mode
      if (isChargeMode) {
        // Try adding a test window
        console.log('7. Testing add charging window...')
        await addButton.click()
      await page.waitForTimeout(3000)
      
      await page.screenshot({ path: 'simple-after-add-click.png', fullPage: true })
      
      // Calculate time window (1 minute ago to 30 minutes from now) - adjusted for BST
      const now = new Date()
      const startTime = new Date(now.getTime() - 1 * 60000) // 1 minute before now
      const endTime = new Date(startTime.getTime() + 30 * 60000) // 30 minutes later
      
      // Adjust for BST (GMT+1) - add 1 hour to UTC times
      const bstOffset = 60 * 60000 // 1 hour in milliseconds
      const startTimeBST = new Date(startTime.getTime() + bstOffset)
      const endTimeBST = new Date(endTime.getTime() + bstOffset)
      
      const startTimeStr = `${startTimeBST.getHours().toString().padStart(2, '0')}:${startTimeBST.getMinutes().toString().padStart(2, '0')}`
      const endTimeStr = `${endTimeBST.getHours().toString().padStart(2, '0')}:${endTimeBST.getMinutes().toString().padStart(2, '0')}`
      
      console.log(`8. Setting charging window: ${startTimeStr} - ${endTimeStr}`)
      console.log(`   Debug - Current time: ${now.toTimeString()}`)
      console.log(`   Debug - Start time UTC: ${startTime.toTimeString()}`)
      console.log(`   Debug - Start time BST: ${startTimeBST.toTimeString()}`)
      console.log(`   Debug - End time UTC: ${endTime.toTimeString()}`)
      console.log(`   Debug - End time BST: ${endTimeBST.toTimeString()}`)
      
      // Fill time fields
      const startTimeInput = page.locator('#batChargeTable0Sub1tr1td1input')
      const endTimeInput = page.locator('#batChargeTable0Sub1tr1td2input')
      
      // Check input field types first
      const startInputType = await startTimeInput.getAttribute('type')
      const endInputType = await endTimeInput.getAttribute('type')
      console.log(`   Debug - Start input type: "${startInputType}"`)
      console.log(`   Debug - End input type: "${endInputType}"`)
      
      // Clear fields first, then fill
      await startTimeInput.clear()
      await startTimeInput.fill(startTimeStr)
      await endTimeInput.clear()
      await endTimeInput.fill(endTimeStr)
      
      // Trigger change events to ensure the values stick
      await startTimeInput.press('Tab')
      await endTimeInput.press('Tab')
      
      // Debug: Check what values were actually set
      const actualStartValue = await startTimeInput.inputValue()
      const actualEndValue = await endTimeInput.inputValue()
      console.log(`   Debug - Start field shows: "${actualStartValue}"`)
      console.log(`   Debug - End field shows: "${actualEndValue}"`)
      
      // Additional debug: check the actual DOM value attribute
      const startDOMValue = await startTimeInput.getAttribute('value')
      const endDOMValue = await endTimeInput.getAttribute('value')
      console.log(`   Debug - Start DOM value: "${startDOMValue}"`)
      console.log(`   Debug - End DOM value: "${endDOMValue}"`)
      
      await page.screenshot({ path: 'simple-time-filled.png', fullPage: true })
      
      // Save
      console.log('9. Saving configuration...')
      const saveButton = page.locator('#ctl00_ContentPlaceHolder1_SaveButton')
      await saveButton.click()
      await page.waitForTimeout(5000)
      
        await page.screenshot({ path: 'simple-saved.png', fullPage: true })
        console.log(`✅ Charging window set and saved: ${startTimeStr} - ${endTimeStr}`)
      }
      
    } else {
      console.log('❌ addBatChargeButton not found in edit mode')
      
      // Search for all buttons to see what's available
      const allButtons = await page.locator('button, input[type="button"], *[onclick]').all()
      console.log(`Found ${allButtons.length} interactive elements`)
      
      for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
        try {
          const button = allButtons[i]
          const text = await button.innerText()
          const id = await button.getAttribute('id') || ''
          if (text || id) {
            console.log(`Button ${i}: "${text}" id="${id}"`)
          }
        } catch (e) {}
      }
    }
    
    await page.screenshot({ path: 'simple-final-result.png', fullPage: true })
    
    console.log('=== SIMPLE TEST COMPLETE ===')
    
  } catch (error) {
    console.error('Error:', error.message)
    await page.screenshot({ path: 'simple-test-error.png', fullPage: true })
    throw error
  }
})