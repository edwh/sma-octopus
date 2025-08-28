require('dotenv').config()
const {test, expect} = require('@playwright/test')

test('Explore Configuration Section for Battery Controls', async ({page}) => {
  console.log('=== EXPLORING CONFIGURATION SECTION FOR BATTERY CONTROLS ===')
  
  await page.setViewportSize({width: 1920, height: 1080})
  
  try {
    console.log('Navigating to Sunny Portal and logging in...')
    await page.goto('https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    // Quick login process
    const currentUrl = page.url()
    if (currentUrl.includes('error=login_required') || currentUrl.includes('SilentLogin=true')) {
      await page.goto('https://www.sunnyportal.com/', { timeout: 30000, waitUntil: 'load' })
      await page.waitForLoadState('networkidle', { timeout: 30000 })
    }
    
    await page.waitForTimeout(3000)
    
    // Handle cookie consent
    try {
      const cookieButton = page.locator('button:has-text("Accept all")').first()
      if (await cookieButton.count() > 0) {
        await cookieButton.click()
        await page.waitForTimeout(1000)
      }
    } catch (e) {}
    
    // Login
    let loginButton = page.locator('*[id$="SmaIdLoginButton"]').first()
    if (await loginButton.count() > 0) {
      await loginButton.click()
      await page.waitForTimeout(3000)
    }
    
    // Fill credentials
    const usernameInput = page.locator('input[name="username"]').first()
    if (await usernameInput.count() > 0) {
      await usernameInput.fill(process.env.SUNNY_PORTAL_USERNAME)
      await page.waitForTimeout(1000)
      
      const passwordInput = page.locator('input[name="password"]').first()
      await passwordInput.fill(process.env.SUNNY_PORTAL_PASSWORD)
      await page.waitForTimeout(1000)
      
      const submitButton = page.locator('button:has-text("Log in")').first()
      await submitButton.click()
      await page.waitForLoadState('networkidle', { timeout: 30000 })
    }
    
    console.log('Login completed')
    
    // Navigate to Live Data page first to see the Configuration section
    console.log('Going to Live Data page...')
    await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx', { 
      timeout: 30000, 
      waitUntil: 'load' 
    })
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    console.log('Looking for Configuration section in sidebar...')
    
    // Look for Configuration link/button in the sidebar
    const configSelectors = [
      'a:has-text("Configuration")',
      'button:has-text("Configuration")',
      '*[href*="Configuration"]',
      '*[href*="config"]',
      '.configuration',
      '#configuration'
    ]
    
    let configLink = null
    for (const selector of configSelectors) {
      try {
        configLink = page.locator(selector).first()
        if (await configLink.count() > 0) {
          console.log(`Found Configuration link: ${selector}`)
          break
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (configLink && await configLink.count() > 0) {
      console.log('Clicking Configuration section...')
      await configLink.click()
      await page.waitForTimeout(3000)
      
      await page.screenshot({ path: 'configuration-section.png', fullPage: true })
      console.log('Configuration section screenshot saved')
      
      // Look for battery-related options
      console.log('Looking for battery charging options...')
      const pageContent = await page.textContent('body')
      
      const batteryKeywords = [
        'battery', 'Battery', 'BATTERY',
        'charging', 'Charging', 'CHARGING', 
        'time window', 'Time window', 'Time Window',
        'storage', 'Storage', 'STORAGE',
        'charge control', 'Charge Control',
        'energy management', 'Energy Management'
      ]
      
      const foundKeywords = batteryKeywords.filter(keyword => pageContent.includes(keyword))
      if (foundKeywords.length > 0) {
        console.log(`✅ Found battery-related content: ${foundKeywords.join(', ')}`)
        
        // Look for specific battery charging controls
        const addBatButton = page.locator('#addBatChargeButton')
        if (await addBatButton.count() > 0) {
          console.log('🎯 FOUND addBatChargeButton!')
        }
        
        const batteryChargeElements = page.locator('*:has-text("Time window control for charging the battery-storage system")')
        if (await batteryChargeElements.count() > 0) {
          console.log('🎯 FOUND "Time window control for charging the battery-storage system"!')
        }
        
        // Look for any forms or tables related to battery
        const forms = await page.locator('form, table').all()
        console.log(`Found ${forms.length} forms/tables to check`)
        
        for (let i = 0; i < forms.length; i++) {
          try {
            const form = forms[i]
            const formText = await form.innerText()
            if (formText.toLowerCase().includes('battery') || formText.toLowerCase().includes('charging')) {
              console.log(`Form/Table ${i}: Contains battery/charging content`)
              console.log(`  Content preview: ${formText.substring(0, 200)}...`)
            }
          } catch (e) {
            // Skip
          }
        }
        
      } else {
        console.log('❌ No battery-related content found in Configuration section')
      }
      
      // List all links in the configuration section
      console.log('\nAll links in Configuration section:')
      const allLinks = await page.locator('a').all()
      for (let i = 0; i < Math.min(allLinks.length, 20); i++) {
        try {
          const link = allLinks[i]
          const text = await link.innerText()
          const href = await link.getAttribute('href')
          if (text && text.trim().length > 0 && text.trim().length < 100) {
            console.log(`  Link ${i}: "${text.trim()}" -> ${href}`)
          }
        } catch (e) {
          // Skip
        }
      }
      
    } else {
      console.log('❌ Configuration section not found')
      
      // Look for any configuration-related links in the sidebar
      console.log('Looking for any configuration links in sidebar...')
      const sidebarLinks = await page.locator('.sidebar a, nav a, [class*="menu"] a, [class*="nav"] a').all()
      
      console.log(`Found ${sidebarLinks.length} sidebar links:`)
      for (let i = 0; i < Math.min(sidebarLinks.length, 15); i++) {
        try {
          const link = sidebarLinks[i]
          const text = await link.innerText()
          const href = await link.getAttribute('href')
          if (text && text.trim().length > 0) {
            console.log(`  ${i}: "${text.trim()}" -> ${href}`)
          }
        } catch (e) {
          // Skip
        }
      }
    }
    
    console.log('\n=== TRYING DIRECT URLS FOR BATTERY CONFIGURATION ===')
    
    // Try some common URLs that might contain battery configuration
    const configUrls = [
      'https://www.sunnyportal.com/Templates/PlantParameterConfiguration.aspx',
      'https://www.sunnyportal.com/Templates/EnergyManagement.aspx', 
      'https://www.sunnyportal.com/Templates/BatteryConfiguration.aspx',
      'https://www.sunnyportal.com/Templates/ChargeControl.aspx',
      'https://www.sunnyportal.com/Templates/TimeWindowConfiguration.aspx'
    ]
    
    for (const url of configUrls) {
      try {
        console.log(`\nTrying: ${url}`)
        await page.goto(url, { timeout: 15000, waitUntil: 'load' })
        await page.waitForTimeout(2000)
        
        const currentUrl = page.url()
        console.log(`  Result URL: ${currentUrl}`)
        
        if (!currentUrl.includes('error=show') && !currentUrl.includes('Start.aspx')) {
          console.log('  ✅ Page accessible!')
          
          const content = await page.textContent('body')
          const hasBatteryContent = batteryKeywords.some(keyword => content.includes(keyword))
          
          if (hasBatteryContent) {
            console.log('  🎯 Contains battery-related content!')
            await page.screenshot({ 
              path: `config-page-${url.split('/').pop().replace('.aspx', '')}.png`, 
              fullPage: true 
            })
            
            // Check for the specific button and section
            const addBatButton = page.locator('#addBatChargeButton')
            if (await addBatButton.count() > 0) {
              console.log('  🎯 FOUND addBatChargeButton on this page!')
            }
            
            const timeWindowText = page.locator('*:has-text("Time window control for charging the battery-storage system")')
            if (await timeWindowText.count() > 0) {
              console.log('  🎯 FOUND time window control section on this page!')
            }
          } else {
            console.log('  ❌ No battery content')
          }
        } else {
          console.log('  ❌ Page not accessible or redirected to error')
        }
      } catch (e) {
        console.log(`  ❌ Error accessing: ${e.message}`)
      }
    }
    
    console.log('\n=== BATTERY CONFIGURATION EXPLORATION COMPLETE ===')
    
  } catch (error) {
    console.error('Error exploring configuration:', error.message)
    await page.screenshot({ path: 'config-exploration-error.png', fullPage: true })
    throw error
  }
})