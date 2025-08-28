require('dotenv').config()
const {test, expect} = require('@playwright/test')

test('Explore SMA Battery Parameters for Grid Charging', async ({page}) => {
  console.log('=== EXPLORING SMA BATTERY PARAMETERS FOR GRID CHARGING ===')
  
  await page.setViewportSize({width: 2048, height: 1536})

  try {
    console.log(`Navigating to inverter at ${process.env.inverterIP}...`)
    await page.goto('http://' + process.env.inverterIP + '/#/login', { timeout: 60000 })
    
    // Wait for dropdown and login
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
    
    // Explore Battery section parameters
    console.log('\n=== EXPLORING BATTERY SECTION ===')
    const batterySection = page.locator('span', {
      hasText: 'Battery'
    }).first()
    await batterySection.click({ timeout: 15000 })
    await page.waitForTimeout(3000)
    
    // Get all battery-related parameters
    console.log('Scanning all battery parameters...')
    const rows = await page.locator('tr').all()
    const batteryParams = []
    
    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i]
        const rowText = await row.innerText()
        
        if (rowText && (
          rowText.includes('battery') || 
          rowText.includes('Battery') ||
          rowText.includes('charge') ||
          rowText.includes('Charge') ||
          rowText.includes('discharge') ||
          rowText.includes('Discharge') ||
          rowText.includes('grid') ||
          rowText.includes('Grid') ||
          rowText.includes('time') ||
          rowText.includes('Time') ||
          rowText.includes('mode') ||
          rowText.includes('Mode') ||
          rowText.includes('consumption') ||
          rowText.includes('self') ||
          rowText.includes('Self')
        )) {
          const cells = await row.locator('td').all()
          if (cells.length >= 2) {
            try {
              const label = await cells[0].innerText()
              const valueElement = cells[1]
              let value = 'N/A'
              
              // Try to get value from input, select, or text
              const inputs = await valueElement.locator('input').all()
              const selects = await valueElement.locator('select').all()
              
              if (inputs.length > 0) {
                value = await inputs[0].inputValue()
              } else if (selects.length > 0) {
                value = await selects[0].inputValue()
              } else {
                value = await valueElement.innerText()
              }
              
              batteryParams.push({
                label: label.trim(),
                value: value.trim(),
                type: inputs.length > 0 ? 'input' : selects.length > 0 ? 'select' : 'text'
              })
            } catch (e) {
              // Skip problematic rows
            }
          }
        }
      } catch (e) {
        // Skip problematic rows
      }
    }
    
    console.log('\n📋 BATTERY PARAMETERS FOUND:')
    console.log('═'.repeat(80))
    batteryParams.forEach((param, idx) => {
      console.log(`${idx + 1}. ${param.label}`)
      console.log(`   Value: ${param.value} (${param.type})`)
      console.log(`   ---`)
    })
    
    // Look for other sections that might contain charging parameters
    console.log('\n=== EXPLORING OTHER SECTIONS FOR CHARGING OPTIONS ===')
    
    // Check for Energy Management, Time Control, or Grid Management sections
    const sectionNames = [
      'Energy Management', 'Energy', 'Grid', 'Grid Management', 
      'Time Control', 'Time', 'Operating Mode', 'Mode',
      'Self Consumption', 'Consumption', 'AC', 'DC'
    ]
    
    for (const sectionName of sectionNames) {
      try {
        console.log(`\nChecking for ${sectionName} section...`)
        const section = page.locator('span', { hasText: sectionName }).first()
        
        if (await section.count() > 0) {
          console.log(`✅ Found ${sectionName} section, expanding...`)
          await section.click({ timeout: 5000 })
          await page.waitForTimeout(2000)
          
          // Scan parameters in this section
          const sectionRows = await page.locator('tr').all()
          const sectionParams = []
          
          for (let i = 0; i < Math.min(sectionRows.length, 50); i++) {
            try {
              const row = sectionRows[i]
              const rowText = await row.innerText()
              
              if (rowText && (
                rowText.toLowerCase().includes('charg') ||
                rowText.toLowerCase().includes('grid') ||
                rowText.toLowerCase().includes('time') ||
                rowText.toLowerCase().includes('mode') ||
                rowText.toLowerCase().includes('operating') ||
                rowText.toLowerCase().includes('control')
              )) {
                const cells = await row.locator('td').all()
                if (cells.length >= 2) {
                  try {
                    const label = await cells[0].innerText()
                    let value = 'N/A'
                    
                    const inputs = await cells[1].locator('input').all()
                    const selects = await cells[1].locator('select').all()
                    
                    if (inputs.length > 0) {
                      value = await inputs[0].inputValue()
                    } else if (selects.length > 0) {
                      // For select elements, also get the options
                      const selectedValue = await selects[0].inputValue()
                      const options = await selects[0].locator('option').all()
                      const optionTexts = []
                      for (const option of options) {
                        const optionText = await option.innerText()
                        optionTexts.push(optionText)
                      }
                      value = `${selectedValue} (options: ${optionTexts.join(', ')})`
                    } else {
                      value = await cells[1].innerText()
                    }
                    
                    sectionParams.push({
                      section: sectionName,
                      label: label.trim(),
                      value: value.trim()
                    })
                  } catch (e) {
                    // Skip
                  }
                }
              }
            } catch (e) {
              // Skip
            }
          }
          
          if (sectionParams.length > 0) {
            console.log(`\n📋 CHARGING-RELATED PARAMETERS IN ${sectionName.toUpperCase()}:`)
            sectionParams.forEach((param, idx) => {
              console.log(`${idx + 1}. ${param.label}`)
              console.log(`   Value: ${param.value}`)
              console.log(`   ---`)
            })
          } else {
            console.log(`   No charging-related parameters found in ${sectionName}`)
          }
        } else {
          console.log(`   ${sectionName} section not found`)
        }
      } catch (e) {
        console.log(`   Error exploring ${sectionName}: ${e.message}`)
      }
    }
    
    // Take a screenshot for manual review
    await page.screenshot({ 
      path: 'battery-parameters-exploration.png', 
      fullPage: true 
    })
    console.log('\n📸 Screenshot saved as battery-parameters-exploration.png')
    
    console.log('\n=== EXPLORATION COMPLETE ===')
    console.log('Review the parameters above to identify options for:')
    console.log('1. Operating modes (Time of Use, Grid Charge, etc.)')
    console.log('2. Charging time windows')
    console.log('3. Target SOC settings')
    console.log('4. Grid charging enable/disable')
    console.log('5. Charging power limits')
    
  } catch (error) {
    console.error('Error exploring battery parameters:', error.message)
    await page.screenshot({ path: 'battery-exploration-error.png', fullPage: true })
    throw error
  }
})