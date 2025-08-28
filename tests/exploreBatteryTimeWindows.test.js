require('dotenv').config()
const {test, expect} = require('@playwright/test')

test('Explore Battery Time Windows for Grid Charging', async ({page}) => {
  console.log('=== EXPLORING BATTERY TIME WINDOWS FOR GRID CHARGING ===')
  
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
    
    console.log('Navigating to Device Parameters...')
    await page.click('#lDeviceParameter', { timeout: 30000 })
    
    console.log('Clicking Parameter Edit...')
    await page.click('#bParameterEdit', { timeout: 20000 })
    
    // Navigate to Battery section (this should be the main one with time windows)
    console.log('\n=== ACCESSING BATTERY SECTION FOR TIME WINDOWS ===')
    const batterySection = page.locator('span', { hasText: 'Battery' }).first()
    
    if (await batterySection.count() === 0) {
      console.log('Battery section not found, listing all sections...')
      const sections = await page.locator('span[uib-accordion-header]').all()
      console.log('Available sections:')
      for (const section of sections) {
        try {
          const text = await section.innerText()
          console.log(`  - ${text}`)
        } catch (e) {
          // Skip
        }
      }
      throw new Error('Battery section not found')
    }
    
    await batterySection.click({ timeout: 15000 })
    await page.waitForTimeout(3000)
    
    console.log('Battery section expanded, looking for time window parameters...')
    
    // Function to find and read a parameter
    async function findParameter(parameterName) {
      console.log(`\n🔍 Looking for parameter: "${parameterName}"`)
      
      // Try exact match first
      let paramElement = page.locator('td', { hasText: parameterName }).first()
      
      // If not found, try partial match
      if (await paramElement.count() === 0) {
        paramElement = page.locator('td').filter({ hasText: new RegExp(parameterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
      }
      
      if (await paramElement.count() > 0) {
        const paramRow = paramElement.locator('..').first()
        const valueCells = await paramRow.locator('td').all()
        
        if (valueCells.length >= 2) {
          const valueCell = valueCells[1]
          
          // Check for input field
          const inputs = await valueCell.locator('input').all()
          if (inputs.length > 0) {
            const value = await inputs[0].inputValue()
            console.log(`  ✅ ${parameterName}: "${value}" (input - can be modified)`)
            return { value, type: 'input', element: inputs[0] }
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
            console.log(`  ✅ ${parameterName}: "${value}" (select - options: ${optionTexts.join(', ')})`)
            return { value, type: 'select', options: optionTexts, element: selects[0] }
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
    
    // Look for time window parameters we found earlier
    console.log('\n=== TIME WINDOW PARAMETERS ===')
    const startTimeA = await findParameter('Start time [A]')
    const endTimeA = await findParameter('End time [A]')
    const startTimeB = await findParameter('Start time [B]') 
    const endTimeB = await findParameter('End time [B]')
    
    console.log('\n=== SOC LIMIT PARAMETERS ===')
    const socLimitA = await findParameter('Limit of battery state of charge [A]')
    const socLimitB = await findParameter('Limit of battery state of charge [B]')
    const socLimitC = await findParameter('Limit of battery state of charge [C]')
    
    console.log('\n=== SELF-CONSUMPTION PARAMETER (current method) ===')
    const selfConsumption = await findParameter('Minimum width of self-consumption area')
    
    console.log('\n=== OTHER CHARGING-RELATED PARAMETERS ===')
    await findParameter('Time for full charge')
    await findParameter('Maximum discharge current')
    await findParameter('Area width for conserving battery state of charge')
    await findParameter('Minimum width of deep discharge protection area')
    
    // Take detailed screenshot
    await page.screenshot({ path: 'battery-time-windows-detailed.png', fullPage: true })
    console.log('\n📸 Detailed screenshot saved: battery-time-windows-detailed.png')
    
    // Show current configuration summary
    console.log('\n' + '='.repeat(60))
    console.log('🔋 CURRENT BATTERY TIME WINDOW CONFIGURATION')
    console.log('='.repeat(60))
    
    if (startTimeA && endTimeA) {
      console.log(`⏰ Time Window A: ${startTimeA.value} → ${endTimeA.value}`)
      if (socLimitA) {
        console.log(`🎯 SOC Target A: ${socLimitA.value}%`)
      }
    }
    
    if (startTimeB && endTimeB) {
      console.log(`⏰ Time Window B: ${startTimeB.value} → ${endTimeB.value}`)
      if (socLimitB) {
        console.log(`🎯 SOC Target B: ${socLimitB.value}%`)
      }
    }
    
    if (selfConsumption) {
      console.log(`⚡ Self-consumption area: ${selfConsumption.value} (current charging method)`)
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('🎯 OCTOPUS GO CONFIGURATION NEEDED')
    console.log('='.repeat(60))
    console.log('For Octopus Go (00:30-04:30) charging:')
    console.log('  Time Window A: 00:30:00 → 04:30:00')
    console.log('  SOC Target A: 40% (or desired level)')
    console.log('  Time Window B: Can be used for other periods')
    
    console.log('\nCurrent Window A spans:', startTimeA?.value, '→', endTimeA?.value)
    if (startTimeA?.value === '22:00:00' && endTimeA?.value === '06:00:00') {
      console.log('✅ Window A already covers Octopus Go period (00:30-04:30)')
      console.log('   Just need to ensure SOC limit triggers grid charging')
    } else {
      console.log('⚠️  Window A needs adjustment for Octopus Go timing')
    }
    
    // Analysis of what parameters can be modified
    console.log('\n' + '='.repeat(60))
    console.log('🔧 MODIFIABLE PARAMETERS FOR GRID CHARGING')
    console.log('='.repeat(60))
    
    const modifiableParams = [
      startTimeA, endTimeA, startTimeB, endTimeB, 
      socLimitA, socLimitB, socLimitC, selfConsumption
    ].filter(param => param && param.type === 'input')
    
    modifiableParams.forEach(param => {
      console.log(`  📝 Can modify: ${param.paramName || 'parameter'} (current: ${param.value})`)
    })
    
    console.log('\n=== BATTERY TIME WINDOW EXPLORATION COMPLETE ===')
    console.log('Next steps:')
    console.log('1. Test if time windows A/B actually force grid charging')
    console.log('2. Compare with current self-consumption method')  
    console.log('3. Implement proper Octopus Go time window configuration')
    
  } catch (error) {
    console.error('Error exploring battery time windows:', error.message)
    await page.screenshot({ path: 'battery-time-windows-error.png', fullPage: true })
    throw error
  }
})