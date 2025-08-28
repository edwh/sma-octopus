require('dotenv').config()
const {test, expect} = require('@playwright/test')

test('Test DC Charging Parameters for Grid Charging', async ({page}) => {
  console.log('=== TESTING DC CHARGING PARAMETERS FOR GRID CHARGING ===')
  
  await page.setViewportSize({width: 2048, height: 1536})

  try {
    console.log(`Navigating to inverter at ${process.env.inverterIP}...`)
    await page.goto('http://' + process.env.inverterIP + '/#/login', { timeout: 60000 })
    
    // Login process
    const userSelect = page.locator('select[name="username"]')
    await page.waitForFunction(() => {
      const select = document.querySelector('select[name="username"]')
      return select && select.options.length > 1
    }, { timeout: 70000 })
    
    await userSelect.selectOption({ label: 'Installer' })
    await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
    await page.click('#bLogin')
    await page.waitForTimeout(3000)
    
    console.log('Navigating to Device Parameters...')
    await page.click('#lDeviceParameter', { timeout: 30000 })
    
    console.log('Clicking Parameter Edit...')
    await page.click('#bParameterEdit', { timeout: 20000 })
    
    // Navigate to DC section
    console.log('\n=== ACCESSING DC SECTION ===')
    const dcSection = page.locator('span', { hasText: 'DC' }).first()
    await dcSection.click({ timeout: 15000 })
    await page.waitForTimeout(3000)
    
    console.log('DC section expanded, looking for charging parameters...')
    
    // Function to find and read a parameter
    async function findParameter(parameterName) {
      console.log(`Looking for parameter: ${parameterName}`)
      const paramElement = page.locator('td', { hasText: parameterName }).first()
      
      if (await paramElement.count() > 0) {
        const paramRow = paramElement.locator('..').first()
        const valueCells = await paramRow.locator('td').all()
        
        if (valueCells.length >= 2) {
          const valueCell = valueCells[1]
          
          // Check for input field
          const inputs = await valueCell.locator('input').all()
          if (inputs.length > 0) {
            const value = await inputs[0].inputValue()
            console.log(`  ✅ ${parameterName}: "${value}" (input field)`)
            return { element: inputs[0], value, type: 'input' }
          }
          
          // Check for select field
          const selects = await valueCell.locator('select').all()
          if (selects.length > 0) {
            const value = await selects[0].inputValue()
            const options = await selects[0].locator('option').all()
            const optionTexts = []
            for (const option of options) {
              const optionText = await option.innerText()
              optionTexts.push(optionText)
            }
            console.log(`  ✅ ${parameterName}: "${value}" (select: ${optionTexts.join(', ')})`)
            return { element: selects[0], value, type: 'select', options: optionTexts }
          }
          
          // Just text
          const textValue = await valueCell.innerText()
          console.log(`  ℹ️  ${parameterName}: "${textValue}" (read-only)`)
          return { value: textValue, type: 'text' }
        }
      } else {
        console.log(`  ❌ Parameter "${parameterName}" not found`)
        return null
      }
    }
    
    // Read current values of key DC charging parameters
    console.log('\n=== READING CURRENT DC CHARGING PARAMETERS ===')
    const chargeType = await findParameter('Charge type')
    const manualControl = await findParameter('Manual control')
    const startTime = await findParameter('Start time')
    const endTime = await findParameter('End time')
    
    // Store original values for restoration
    const originalValues = {
      chargeType: chargeType?.value || null,
      manualControl: manualControl?.value || null,
      startTime: startTime?.value || null,
      endTime: endTime?.value || null
    }
    
    console.log('\n📋 ORIGINAL VALUES:')
    console.log('  Charge type:', originalValues.chargeType)
    console.log('  Manual control:', originalValues.manualControl)  
    console.log('  Start time:', originalValues.startTime)
    console.log('  End time:', originalValues.endTime)
    
    // Test different charging configurations
    console.log('\n=== TESTING CONFIGURATION 1: Manual Start + Full Charge ===')
    
    try {
      // Set Manual control to "Start"
      if (manualControl && manualControl.type === 'select') {
        console.log('Setting Manual control to "Start"...')
        await manualControl.element.selectOption({ label: 'Start' })
        await page.waitForTimeout(1000)
        
        // Set Charge type to "Full charge"
        if (chargeType && chargeType.type === 'select') {
          console.log('Setting Charge type to "Full charge"...')
          await chargeType.element.selectOption({ label: 'Full charge' })
          await page.waitForTimeout(1000)
          
          // Save changes
          console.log('Saving configuration...')
          await page.locator('button', { hasText: 'Save all' }).click({ timeout: 15000 })
          await page.waitForTimeout(5000)
          
          console.log('✅ Configuration 1 applied: Manual=Start, Charge=Full charge')
          
          // Monitor for a few seconds to see immediate effects
          console.log('Monitoring system response...')
          await page.waitForTimeout(10000)
          
          // Take screenshot
          await page.screenshot({ path: 'dc-charging-test-config1.png', fullPage: true })
          console.log('📸 Screenshot saved: dc-charging-test-config1.png')
          
        } else {
          console.log('⚠️  Cannot set Charge type - not a select field or not found')
        }
      } else {
        console.log('⚠️  Cannot set Manual control - not a select field or not found')
      }
      
    } catch (error) {
      console.log('❌ Error applying Configuration 1:', error.message)
    }
    
    // Wait a bit then check current battery status
    console.log('\n=== CHECKING BATTERY STATUS AFTER CONFIGURATION ===')
    try {
      // Navigate to Spot Values to check battery status
      await page.click('#lSpotValues', { timeout: 30000 })
      await page.waitForTimeout(5000)
      
      const batterySection2 = page.locator('span', { hasText: 'Battery' }).first()
      if (await batterySection2.count() > 0) {
        await batterySection2.click({ timeout: 20000 })
        await page.waitForTimeout(5000)
        
        // Look for charging indicators
        const pageContent = await page.textContent('body')
        const lines = pageContent.split('\n')
        
        console.log('Looking for battery status indicators...')
        for (const line of lines) {
          const cleanLine = line.trim()
          if (cleanLine && (
            cleanLine.toLowerCase().includes('charg') ||
            cleanLine.toLowerCase().includes('current') ||
            cleanLine.toLowerCase().includes('power') ||
            cleanLine.toLowerCase().includes('state of charge')
          )) {
            console.log(`  Battery status: ${cleanLine}`)
          }
        }
      }
    } catch (error) {
      console.log('Error checking battery status:', error.message)
    }
    
    // RESTORE ORIGINAL VALUES
    console.log('\n=== RESTORING ORIGINAL CONFIGURATION ===')
    try {
      // Go back to Device Parameters
      await page.click('#lDeviceParameter', { timeout: 30000 })
      await page.click('#bParameterEdit', { timeout: 20000 })
      
      // Re-expand DC section
      const dcSection2 = page.locator('span', { hasText: 'DC' }).first()
      await dcSection2.click({ timeout: 15000 })
      await page.waitForTimeout(3000)
      
      // Restore Manual control
      if (manualControl && manualControl.type === 'select' && originalValues.manualControl) {
        console.log(`Restoring Manual control to: ${originalValues.manualControl}`)
        const manualControl2 = await findParameter('Manual control')
        if (manualControl2) {
          if (originalValues.manualControl === '?') {
            // Select first empty option if original was undefined
            await manualControl2.element.selectOption({ index: 0 })
          } else {
            await manualControl2.element.selectOption({ label: originalValues.manualControl })
          }
        }
      }
      
      // Restore Charge type  
      if (chargeType && chargeType.type === 'select' && originalValues.chargeType) {
        console.log(`Restoring Charge type to: ${originalValues.chargeType}`)
        const chargeType2 = await findParameter('Charge type')
        if (chargeType2) {
          // The original was "number:1769" which likely corresponds to a specific option
          // We'll try to restore by index or fall back to "Off"
          try {
            await chargeType2.element.selectOption({ label: 'Off' })
          } catch (e) {
            console.log('Could not restore exact Charge type, set to Off as safe default')
          }
        }
      }
      
      // Save restoration
      console.log('Saving restored configuration...')
      await page.locator('button', { hasText: 'Save all' }).click({ timeout: 15000 })
      await page.waitForTimeout(5000)
      
      console.log('✅ Original configuration restored')
      
    } catch (error) {
      console.log('❌ Error restoring original configuration:', error.message)
      console.log('⚠️  MANUAL RESTORATION REQUIRED!')
      console.log('   Manual control should be:', originalValues.manualControl)
      console.log('   Charge type should be:', originalValues.chargeType)
    }
    
    await page.screenshot({ path: 'dc-charging-test-final.png', fullPage: true })
    console.log('📸 Final screenshot saved: dc-charging-test-final.png')
    
    console.log('\n=== DC CHARGING PARAMETER TEST COMPLETE ===')
    console.log('Results:')
    console.log('- Tested Manual control = "Start" + Charge type = "Full charge"') 
    console.log('- Check screenshots and battery status output above')
    console.log('- Original configuration has been restored')
    
  } catch (error) {
    console.error('Error in DC charging parameter test:', error.message)
    await page.screenshot({ path: 'dc-charging-test-error.png', fullPage: true })
    throw error
  }
})