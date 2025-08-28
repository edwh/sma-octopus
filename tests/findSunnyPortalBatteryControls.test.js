require('dotenv').config()
const {test, expect} = require('@playwright/test')

test('Find Sunny Portal Battery Charging Controls', async ({page}) => {
  console.log('=== FINDING SUNNY PORTAL BATTERY CHARGING CONTROLS ===')
  
  await page.setViewportSize({width: 1920, height: 1080})
  
  try {
    console.log('Navigating to Sunny Portal and logging in...')
    await page.goto('https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    // Login process (simplified)
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
    
    // Explore different pages for battery controls
    const pagesToExplore = [
      {
        name: 'Plant Formula Configuration', 
        url: 'https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx'
      },
      {
        name: 'Live Data Page',
        url: 'https://www.sunnyportal.com/FixedPages/HoManLive.aspx'
      },
      {
        name: 'Parameters',
        url: 'https://www.sunnyportal.com/Templates/Parameters.aspx'
      },
      {
        name: 'Plant Settings',
        url: 'https://www.sunnyportal.com/Templates/PlantSettings.aspx'
      }
    ]
    
    for (const pageInfo of pagesToExplore) {
      console.log(`\n=== EXPLORING: ${pageInfo.name} ===`)
      
      try {
        await page.goto(pageInfo.url, { timeout: 30000, waitUntil: 'load' })
        await page.waitForLoadState('networkidle', { timeout: 30000 })
        await page.waitForTimeout(3000)
        
        console.log(`Current URL: ${page.url()}`)
        
        // Take screenshot
        await page.screenshot({ 
          path: `page-${pageInfo.name.toLowerCase().replace(/\s+/g, '-')}.png`, 
          fullPage: true 
        })
        
        // Look for battery-related content
        const pageContent = await page.textContent('body')
        const batteryKeywords = [
          'battery', 'Battery', 'BATTERY',
          'charging', 'Charging', 'CHARGING',
          'time window', 'Time window', 'Time Window',
          'addBatChargeButton',
          'storage', 'Storage', 'STORAGE'
        ]
        
        console.log('Battery-related content found:')
        const foundKeywords = []
        for (const keyword of batteryKeywords) {
          if (pageContent.includes(keyword)) {
            foundKeywords.push(keyword)
          }
        }
        
        if (foundKeywords.length > 0) {
          console.log(`  ✅ Found: ${foundKeywords.join(', ')}`)
          
          // Look for specific elements
          const addBatButton = page.locator('#addBatChargeButton')
          if (await addBatButton.count() > 0) {
            console.log('  🎯 FOUND addBatChargeButton!')
          }
          
          const editButtons = await page.locator('button:has-text("Edit"), input[value="Edit"]').all()
          if (editButtons.length > 0) {
            console.log(`  📝 Found ${editButtons.length} Edit button(s)`)
          }
          
          const removeButtons = page.locator('img[src="../Tools/images/buttons/remove_segment_btn.png"]')
          if (await removeButtons.count() > 0) {
            console.log(`  🗑️ Found ${await removeButtons.count()} remove segment button(s)`)
          }
          
        } else {
          console.log('  ❌ No battery-related content found')
        }
        
        // Check for tabs on this page
        const tabs = await page.locator('a[href*="aspx"], button, .tab, [role="tab"]').all()
        if (tabs.length > 0) {
          console.log(`  📑 Found ${tabs.length} potential tabs/links to explore`)
          
          for (let i = 0; i < Math.min(tabs.length, 10); i++) {
            try {
              const tab = tabs[i]
              const text = await tab.innerText()
              const href = await tab.getAttribute('href')
              if (text && text.trim().length > 0 && text.trim().length < 50) {
                console.log(`    Tab ${i}: "${text.trim()}" ${href ? `-> ${href}` : ''}`)
              }
            } catch (e) {
              // Skip
            }
          }
        }
        
        // If this is the PlantFormulaConfiguration page, explore tabs
        if (pageInfo.name === 'Plant Formula Configuration') {
          console.log('\n  Exploring tabs on Plant Formula Configuration...')
          
          const tabNames = ['Parameters', 'Data relevance', 'Saving configuration']
          for (const tabName of tabNames) {
            try {
              console.log(`  Clicking ${tabName} tab...`)
              const tab = page.locator(`a:has-text("${tabName}")`).first()
              if (await tab.count() > 0) {
                await tab.click()
                await page.waitForTimeout(3000)
                
                const tabContent = await page.textContent('body')
                const tabBatteryKeywords = batteryKeywords.filter(keyword => tabContent.includes(keyword))
                
                if (tabBatteryKeywords.length > 0) {
                  console.log(`    ✅ ${tabName} tab contains: ${tabBatteryKeywords.join(', ')}`)
                  await page.screenshot({ 
                    path: `plant-formula-${tabName.toLowerCase().replace(/\s+/g, '-')}-tab.png`, 
                    fullPage: true 
                  })
                  
                  // Check for addBatChargeButton in this tab
                  const addBatButtonInTab = page.locator('#addBatChargeButton')
                  if (await addBatButtonInTab.count() > 0) {
                    console.log('    🎯 FOUND addBatChargeButton in this tab!')
                  }
                } else {
                  console.log(`    ❌ ${tabName} tab: no battery content`)
                }
              }
            } catch (e) {
              console.log(`    Error exploring ${tabName} tab: ${e.message}`)
            }
          }
        }
        
      } catch (error) {
        console.log(`Error exploring ${pageInfo.name}: ${error.message}`)
      }
    }
    
    console.log('\n=== BATTERY CONTROL SEARCH COMPLETE ===')
    console.log('Check the screenshots saved to see the content of each page')
    console.log('Look for pages that contain:')
    console.log('- "Time window control for charging the battery-storage system"')
    console.log('- addBatChargeButton element')
    console.log('- Edit buttons with battery charging forms')
    
  } catch (error) {
    console.error('Error in battery control search:', error.message)
    await page.screenshot({ path: 'battery-search-error.png', fullPage: true })
    throw error
  }
})