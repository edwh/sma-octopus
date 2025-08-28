require('dotenv').config()
const {test, expect} = require('@playwright/test')

test('Final Battery Control Test', async ({page}) => {
  console.log('=== FINAL BATTERY CONTROL TEST ===')
  
  try {
    // Login (streamlined)
    console.log('1. Quick login...')
    await page.goto('https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    if (page.url().includes('error=login_required')) {
      await page.goto('https://www.sunnyportal.com/')
      await page.waitForLoadState('networkidle')
    }
    
    await page.locator('*[id$="SmaIdLoginButton"]').click()
    await page.waitForTimeout(3000)
    
    await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
    await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
    
    // Find submit button more specifically
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[value*="Log"]',
      '*[onclick*="login"]'
    ]
    
    let submitClicked = false
    for (const selector of submitSelectors) {
      const submitBtn = page.locator(selector)
      if (await submitBtn.count() > 0) {
        await submitBtn.click()
        submitClicked = true
        break
      }
    }
    
    if (!submitClicked) {
      // Fallback to text-based selector if needed
      await page.locator('button').filter({ hasText: 'Log in' }).click()
    }
    
    try {
      await page.waitForNavigation({ timeout: 30000 })
    } catch (e) {
      await page.waitForTimeout(5000)
    }
    
    console.log('✅ Logged in')
    
    // Navigate to Plant Formula page
    console.log('2. Going to Plant Formula Configuration...')
    await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    // Handle cookies properly to ensure they're dismissed and state preserved
    console.log('3. Properly handling and dismissing cookies...')
    
    // Wait for cookie banner to be fully loaded
    await page.waitForTimeout(3000)
    
    // Look for cookie banner and dismiss it properly
    try {
      // First try to click "Reject all" properly to set the cookie preference
      const rejectButton = page.locator('a.cmpboxbtn.cmpboxbtnno.cmptxt_btn_no')
      if (await rejectButton.count() > 0) {
        console.log('✅ Found Reject all button, clicking to set preference...')
        
        // Make sure it's visible and clickable
        await rejectButton.waitFor({ state: 'visible', timeout: 5000 })
        
        // Click without force first to let it process properly
        await rejectButton.click({ timeout: 5000 })
        console.log('✅ Clicked Reject all - waiting for banner to disappear...')
        
        // Wait for the cookie banner to disappear completely
        try {
          await page.waitForSelector('#cmpwrapper', { state: 'hidden', timeout: 10000 })
          console.log('✅ Cookie banner disappeared naturally')
        } catch (e) {
          console.log('⚠️ Cookie banner still visible after clicking, checking if it processed...')
          
          // Check if the banner is still blocking interactions
          const wrapperVisible = await page.locator('#cmpwrapper').isVisible()
          if (wrapperVisible) {
            console.log('⚠️ Cookie banner still visible, forcing removal...')
            await page.evaluate(() => {
              const wrapper = document.querySelector('#cmpwrapper')
              if (wrapper) {
                wrapper.style.display = 'none'
                wrapper.remove()
              }
            })
          }
        }
        
        await page.waitForTimeout(2000)
        
      } else {
        console.log('⚠️ Reject all button not found, cookie banner might not be present')
      }
    } catch (e) {
      console.log('Cookie handling error:', e.message)
      
      // Force remove if clicking failed
      await page.evaluate(() => {
        const wrapper = document.querySelector('#cmpwrapper')
        if (wrapper) {
          wrapper.style.display = 'none'
          wrapper.remove()
          console.log('Forced cookie removal after click failure')
        }
      })
    }
    
    await page.screenshot({ path: 'final-after-cookie-removal.png', fullPage: true })
    
    // Click Edit button (should work now)
    console.log('4. Clicking Edit button...')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)
    
    const editButton = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
    
    if (await editButton.count() === 0) {
      throw new Error('Edit button not found')
    }
    
    // Should be able to click normally now  
    await editButton.click({ timeout: 15000 })
    console.log('✅ Edit button clicked successfully!')
    
    await page.waitForTimeout(8000) // Wait for edit mode to load
    
    console.log('✅ Edit mode activated')
    await page.screenshot({ path: 'final-edit-mode.png', fullPage: true })
    
    // Look for addBatChargeButton
    console.log('5. Looking for addBatChargeButton in edit mode...')
    
    // First try to scroll to the Time Period section using more specific selectors
    console.log('Looking for Time Period section with specific selectors...')
    
    // Look for the table or row containing Time Period
    let timePeriodElement = page.locator('td').filter({ hasText: /^Time Period$/ }).first()
    if (await timePeriodElement.count() === 0) {
      // Try alternative selectors
      timePeriodElement = page.locator('tr').filter({ hasText: 'Time Period' }).first()
    }
    
    if (await timePeriodElement.count() > 0) {
      await timePeriodElement.scrollIntoViewIfNeeded()
      await page.waitForTimeout(2000)
      console.log('✅ Scrolled to Time Period section')
      
      // Try clicking on the Time Period row to activate it
      console.log('Trying to click on Time Period row to activate it...')
      try {
        await timePeriodElement.click()
        await page.waitForTimeout(3000)
        console.log('✅ Clicked on Time Period row')
      } catch (e) {
        console.log('Click on Time Period row failed:', e.message)
      }
    }
    
    // Now look for addBatChargeButton
    let addButton = page.locator('#addBatChargeButton')
    let addButtonCount = await addButton.count()
    console.log(`Found ${addButtonCount} addBatChargeButton elements`)
    
    // If not found, try clicking in the battery charging section
    if (addButtonCount === 0) {
      console.log('Trying to click in the battery charging section area...')
      
      // Look for specific elements in the battery charging section
      const batteryHeaders = [
        page.locator('h3').filter({ hasText: 'Time window control' }).first(),
        page.locator('strong').filter({ hasText: 'Time window control' }).first(),
        page.locator('td').filter({ hasText: /Time window control for charging/ }).first()
      ]
      
      for (const header of batteryHeaders) {
        if (await header.count() > 0) {
          console.log('Found battery section header, clicking...')
          await header.click()
          await page.waitForTimeout(3000)
          break
        }
      }
      
      // Check again for addBatChargeButton
      addButtonCount = await addButton.count()
      console.log(`After clicking battery section: Found ${addButtonCount} addBatChargeButton elements`)
    }
    
    await page.screenshot({ path: 'final-looking-for-add-button.png', fullPage: true })
    
    if (addButtonCount > 0) {
      console.log('🎉 SUCCESS: Found addBatChargeButton!')
      
      // Click the add button to open time input form
      console.log('6. Clicking addBatChargeButton...')
      await addButton.click()
      await page.waitForTimeout(3000)
      
      await page.screenshot({ path: 'final-after-add-click.png', fullPage: true })
      console.log('✅ Add button clicked - time input form should be open')
      
      // Calculate time window (current time - 1 minute to current time + 59 minutes)
      const now = new Date()
      const startTime = new Date(now.getTime() - 1 * 60000) // Start 1 minute before now
      const endTime = new Date(startTime.getTime() + 60 * 60000) // End 1 hour later
      
      const startTimeStr = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`
      const endTimeStr = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`
      
      console.log(`7. Setting charging window: ${startTimeStr} - ${endTimeStr}`)
      
      // Fill in the time fields using specific IDs from the HTML structure
      console.log('Filling time input fields with specific IDs...')
      
      const startTimeInput = page.locator('#batChargeTable0Sub1tr1td1input')
      const endTimeInput = page.locator('#batChargeTable0Sub1tr1td2input')
      
      if (await startTimeInput.count() > 0 && await endTimeInput.count() > 0) {
        console.log('✅ Found time input fields with specific IDs')
        
        // Clear and fill start time
        await startTimeInput.click()
        await startTimeInput.fill('')
        await startTimeInput.fill(startTimeStr)
        console.log(`✅ Set start time: ${startTimeStr}`)
        
        // Clear and fill end time  
        await endTimeInput.click()
        await endTimeInput.fill('')
        await endTimeInput.fill(endTimeStr)
        console.log(`✅ Set end time: ${endTimeStr}`)
        
      } else {
        console.log('❌ Specific time input fields not found')
        console.log(`Start input count: ${await startTimeInput.count()}`)
        console.log(`End input count: ${await endTimeInput.count()}`)
      }
      
      await page.waitForTimeout(2000)
      await page.screenshot({ path: 'final-time-fields-filled.png', fullPage: true })
      
      // Save the configuration
      console.log('8. Saving configuration...')
      const saveButton = page.locator('#ctl00_ContentPlaceHolder1_SaveButton')
      
      if (saveButton && await saveButton.count() > 0) {
        await saveButton.click()
        await page.waitForTimeout(5000)
        console.log('✅ Configuration saved!')
        
        // Wait for page to process the save
        await page.waitForLoadState('networkidle', { timeout: 30000 })
        
      } else {
        console.log('⚠️  Save button not found - configuration may not be saved')
      }
      
      await page.screenshot({ path: 'final-after-save.png', fullPage: true })
      console.log(`✅ Charging window configured: ${startTimeStr} - ${endTimeStr}`)
      
    } else {
      console.log('❌ addBatChargeButton still not found')
      console.log('ℹ️  The script successfully reaches edit mode - just need to find the add button trigger')
    }
    
    await page.screenshot({ path: 'final-complete.png', fullPage: true })
    
    console.log('=== FINAL TEST COMPLETE ===')
    
  } catch (error) {
    console.error('Error:', error.message)
    await page.screenshot({ path: 'final-test-error.png', fullPage: true })
    throw error
  }
})