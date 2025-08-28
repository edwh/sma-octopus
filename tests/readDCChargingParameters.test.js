require('dotenv').config()
const {test, expect} = require('@playwright/test')

test('Read DC Charging Parameters Only', async ({page}) => {
  console.log('=== READING DC CHARGING PARAMETERS ===')
  
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
    await page.waitForTimeout(5000)
    
    console.log('Looking for navigation menu...')
    
    // Try to find Device Parameter link with various selectors
    const possibleSelectors = [
      '#lDeviceParameter',
      'a[href*="DeviceParameter"]',
      '*:has-text("Device Parameter")',
      '*:has-text("Parameters")',
      '*[onclick*="DeviceParameter"]'
    ]
    
    let deviceParamLink = null
    for (const selector of possibleSelectors) {
      try {
        console.log(`Trying selector: ${selector}`)
        deviceParamLink = page.locator(selector).first()
        if (await deviceParamLink.count() > 0) {
          console.log(`✅ Found Device Parameters with: ${selector}`)
          break
        }
      } catch (e) {
        console.log(`❌ Selector ${selector} failed: ${e.message}`)
      }
    }
    
    if (!deviceParamLink || await deviceParamLink.count() === 0) {
      // Take screenshot to see what's available
      await page.screenshot({ path: 'inverter-main-menu.png', fullPage: true })
      console.log('📸 Main menu screenshot saved: inverter-main-menu.png')
      
      // List all available links
      const allLinks = await page.locator('a, button, *[onclick]').all()
      console.log('Available clickable elements:')
      for (let i = 0; i < Math.min(allLinks.length, 20); i++) {
        try {
          const element = allLinks[i]
          const text = await element.innerText()
          const href = await element.getAttribute('href')
          const onclick = await element.getAttribute('onclick')
          if (text && text.trim().length > 0 && text.trim().length < 50) {
            console.log(`  ${i}: "${text.trim()}" href=${href} onclick=${onclick}`)
          }
        } catch (e) {
          // Skip problematic elements
        }
      }
      
      throw new Error('Could not find Device Parameters link')
    }
    
    console.log('Clicking Device Parameters...')
    await deviceParamLink.click({ timeout: 30000 })
    await page.waitForTimeout(3000)
    
    console.log('Looking for Parameter Edit button...')
    const editSelectors = [
      '#bParameterEdit',
      'button:has-text("Parameter Edit")',
      '*:has-text("Edit")',
      'button[onclick*="Edit"]'
    ]
    
    let editButton = null
    for (const selector of editSelectors) {
      try {
        editButton = page.locator(selector).first()
        if (await editButton.count() > 0) {
          console.log(`✅ Found Parameter Edit with: ${selector}`)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (!editButton || await editButton.count() === 0) {
      await page.screenshot({ path: 'device-parameters-page.png', fullPage: true })
      throw new Error('Could not find Parameter Edit button')
    }
    
    await editButton.click({ timeout: 20000 })
    await page.waitForTimeout(3000)
    
    // Navigate to DC section
    console.log('\n=== ACCESSING DC SECTION ===')
    const dcSection = page.locator('span', { hasText: 'DC' }).first()
    
    if (await dcSection.count() === 0) {
      console.log('DC section not found, taking screenshot...')
      await page.screenshot({ path: 'parameter-sections.png', fullPage: true })
      
      // List available sections
      const sections = await page.locator('span[uib-accordion-header]').all()
      console.log('Available parameter sections:')
      for (const section of sections) {
        try {
          const text = await section.innerText()
          console.log(`  - ${text}`)
        } catch (e) {
          // Skip
        }
      }
      throw new Error('DC section not found')
    }
    
    await dcSection.click({ timeout: 15000 })
    await page.waitForTimeout(3000)
    
    console.log('DC section expanded, reading charging parameters...')
    
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
            return { value, type: 'input' }
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
            console.log(`  ✅ ${parameterName}: "${value}" (options: ${optionTexts.join(', ')})`)
            return { value, type: 'select', options: optionTexts }
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
    
    // Read DC charging parameters
    console.log('\n=== DC CHARGING PARAMETERS ===')
    await findParameter('Charge type')
    await findParameter('Manual control') 
    await findParameter('Start time')
    await findParameter('End time')
    
    // Also look for any other charging-related parameters in DC section
    console.log('\n=== ALL DC PARAMETERS ===')
    const allRows = await page.locator('tr').all()
    
    for (let i = 0; i < allRows.length; i++) {
      try {
        const row = allRows[i]
        const rowText = await row.innerText()
        
        if (rowText && rowText.toLowerCase().includes('charg')) {
          console.log(`DC Charge-related: ${rowText.replace(/\s+/g, ' ').trim()}`)
        }
      } catch (e) {
        // Skip problematic rows
      }
    }
    
    await page.screenshot({ path: 'dc-parameters-read.png', fullPage: true })
    console.log('\n📸 DC parameters screenshot saved: dc-parameters-read.png')
    
    console.log('\n=== DC PARAMETER READING COMPLETE ===')
    
  } catch (error) {
    console.error('Error reading DC parameters:', error.message)
    await page.screenshot({ path: 'dc-read-error.png', fullPage: true })
    throw error
  }
})