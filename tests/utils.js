const {expect} = require('@playwright/test')

exports.setCharging = async function (page, val) {
  const maxRetries = 2
  let attempt = 0
  
  while (attempt <= maxRetries) {
    attempt++
    console.log(`Setting charging parameter attempt ${attempt}/${maxRetries + 1}`)
    
    try {
      console.log(`Navigating to inverter at ${process.env.inverterIP}...`)
      await page.goto('http://' + process.env.inverterIP + '/#/login', { timeout: 30000 })
      
      console.log('Logging in...')
      await page.selectOption('select[name="username"]', 'Installer', { timeout: 15000 })
      await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
      await page.click('#bLogin', { timeout: 15000 })
      
      // Wait for login to complete
      console.log('Waiting for login to complete...')
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      
      console.log('Navigating to Device Parameters...')
      await page.click('#lDeviceParameter', { timeout: 30000 })
      
      console.log('Clicking Parameter Edit...')
      await page.click('#bParameterEdit', { timeout: 20000 })
      
      const batterySection = page.locator('span', {
        hasText: 'Battery'
      }).first()
      await batterySection.click({ timeout: 15000 })
      
      const applicationSection = page.locator('span', {
        hasText: 'Areas of application'
      }).first()

      const selfConsumption = page.locator('td', {
        hasText: 'Minimum width of self-consumption area'
      })

      const selfConsumptionRow = await selfConsumption.locator('..').first()
      const selfConsumptionInput = await selfConsumptionRow.locator('input').first()

      // Set the value - low value forces battery to charge
      console.log(`Setting self-consumption parameter to: ${val}`)
      await selfConsumptionInput.fill(val)

      // Save the changes
      console.log('Saving changes...')
      await page.locator('button', {
        hasText: 'Save all'
      }).click({ timeout: 15000 })
      
      console.log('Parameter saved, waiting for save confirmation...')
      
      // Wait for save operation to complete
      console.log('Waiting for save operation to complete...')
      try {
        // Wait a bit for the save to process
        await page.waitForTimeout(5000)
      } catch (e) {
        // Continue regardless
      }
      
      // Navigate to fresh login page to verify the value was stored
      console.log('Navigating to fresh login page to verify parameter was stored...')
      await page.goto('http://' + process.env.inverterIP + '/#/login', { 
        waitUntil: 'load', 
        timeout: 45000 
      })
      
      // Re-login after navigation
      console.log('Re-logging in for verification...')
      await page.selectOption('select[name="username"]', 'Installer', { timeout: 15000 })
      await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
      await page.click('#bLogin', { timeout: 15000 })
      await page.waitForLoadState('networkidle', { timeout: 45000 })
      
      console.log('Navigating back to Device Parameters for verification...')
      await page.click('#lDeviceParameter', { timeout: 30000 })
      
      console.log('Clicking Parameter Edit for verification...')
      await page.click('#bParameterEdit', { timeout: 20000 })
      
      // Navigate back to the parameter
      console.log('Finding Battery section for verification...')
      const batterySection2 = page.locator('span', { hasText: 'Battery' }).first()
      await batterySection2.click({ timeout: 20000 })
      
      console.log('Looking for self-consumption parameter...')
      const selfConsumption2 = page.locator('td', { hasText: 'Minimum width of self-consumption area' })
      const selfConsumptionRow2 = selfConsumption2.locator('..').first()
      const selfConsumptionInput2 = selfConsumptionRow2.locator('input').first()
      
      // Check the stored value with timeout
      console.log('Reading stored parameter value...')
      const storedValue = await selfConsumptionInput2.inputValue({ timeout: 20000 })
      console.log(`Verification: Expected "${val}", Found "${storedValue}"`)
      
      if (storedValue === val) {
        console.log(`✅ Parameter successfully set and verified on attempt ${attempt}`)
        return page
      } else {
        console.log(`❌ Parameter verification failed on attempt ${attempt}: expected "${val}", got "${storedValue}"`)
        if (attempt > maxRetries) {
          throw new Error(`Failed to set parameter after ${maxRetries + 1} attempts. Expected "${val}", but stored value is "${storedValue}"`)
        }
        console.log(`Retrying after brief delay...`)
        // Brief delay before retry - using page interaction instead of waitForTimeout
        try {
          await page.waitForSelector('body', { timeout: 2000 })
        } catch (e) {
          // Timeout is expected, just used for delay
        }
      }
      
    } catch (error) {
      console.log(`❌ Error on attempt ${attempt}:`, error.message)
      if (attempt > maxRetries) {
        throw new Error(`Failed to set charging parameter after ${maxRetries + 1} attempts: ${error.message}`)
      }
      console.log(`Retrying after brief delay...`)
      // Brief delay before retry
      try {
        await page.waitForSelector('body', { timeout: 2000 })
      } catch (e) {
        // Timeout is expected, just used for delay
      }
    }
  }
  
  throw new Error(`Failed to set charging parameter after ${maxRetries + 1} attempts`)
}

exports.getStateOfCharge = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.click('#lSpotValues')
  const batterySection = await page.locator('span', {
    hasText: 'Battery'
  }).first()
  await batterySection.click()

  // Wait for section to expand - doesn't seem to work using normal Playwright waits.
  await page.waitForTimeout(5000)
  const socPercent = page.locator('td', {
    hasText: 'State of charge'
  })

  const socRow = await socPercent.locator('..').first()
  const socValue = await socRow.locator('.ng-scope').locator('nth=1').first()
  // await socValue.scrollIntoViewIfNeeded()
  let value = await socValue.innerText()
  value = value.replace(' ', '').replace('%', '')
  console.log('SOC', value)
  value = parseInt(value)

  expect(value).toBeGreaterThan(0)
  expect(value).toBeLessThan(100)

  return value
}

exports.getCurrentConsumption = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.click('#lSpotValues')
  
  // Look for consumption values - could be in various sections
  // Common patterns: "AC consumption", "Grid consumption", "Load", etc.
  
  // Wait for page to load
  await page.waitForTimeout(5000)
  
  // Try to find consumption in different possible locations
  const consumptionPatterns = [
    'AC power consumption',
    'Grid consumption', 
    'Load power',
    'Consumption',
    'AC load'
  ]
  
  let consumption = null
  
  for (const pattern of consumptionPatterns) {
    try {
      const consumptionElement = page.locator('td', { hasText: pattern }).first()
      if (await consumptionElement.count() > 0) {
        const consumptionRow = await consumptionElement.locator('..').first()
        const consumptionValue = await consumptionRow.locator('.ng-scope').locator('nth=1').first()
        
        let value = await consumptionValue.innerText()
        // Remove units (W, kW) and spaces, convert to watts
        value = value.replace(/\s/g, '').replace('W', '').replace('kW', '').replace(',', '.')
        
        if (value.includes('k')) {
          // Convert kW to W
          consumption = parseFloat(value.replace('k', '')) * 1000
        } else {
          consumption = parseFloat(value)
        }
        
        console.log('Consumption', consumption)
        break
      }
    } catch (e) {
      // Continue to next pattern
    }
  }
  
  if (consumption === null) {
    console.log('Could not find consumption data on page')
  }

  return consumption
}

exports.getBatteryCapacity = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.waitForTimeout(5000)
  
  let capacity = null
  
  try {
    // Navigate to Device Parameters where the actual rated capacity is stored
    await page.click('#lDeviceParameter')
    await page.waitForTimeout(3000)
    
    // Find and expand Battery section
    const batterySection = page.locator('span', { hasText: 'Battery' }).first()
    if (await batterySection.count() > 0) {
      await batterySection.click()
      await page.waitForTimeout(3000)
      
      // Look specifically for "Rated capacity" in the Battery parameters
      // From our exploration, we found: "Rated capacity	31,200 Wh"
      const pageContent = await page.textContent('body')
      
      // Search for the rated capacity line
      const lines = pageContent.split('\n')
      for (const line of lines) {
        if (line.includes('Rated capacity') && line.includes('Wh')) {
          // Extract the value: "Rated capacity	31,200 Wh" -> "31,200"
          const match = line.match(/Rated capacity\s+([0-9,]+)\s*Wh/)
          if (match) {
            const whValue = parseFloat(match[1].replace(',', ''))
            capacity = whValue / 1000  // Convert Wh to kWh
            console.log('Capacity found:', whValue, 'Wh =', capacity, 'kWh')
            break
          }
        }
      }
      
      if (capacity === null) {
        console.log('Could not find "Rated capacity" field in expected format')
        // Try alternative parsing - look for the table structure
        const tables = await page.locator('table').all()
        
        for (const table of tables) {
          const rows = await table.locator('tr').all()
          
          for (const row of rows) {
            try {
              const cells = await row.locator('td').all()
              if (cells.length >= 2) {
                const label = await cells[0].innerText()
                const value = await cells[1].innerText()
                
                if (label.trim() === 'Rated capacity' && value.includes('Wh')) {
                  // Extract numeric value from something like "31,200 Wh"
                  const whMatch = value.match(/([0-9,]+)\s*Wh/)
                  if (whMatch) {
                    const whValue = parseFloat(whMatch[1].replace(',', ''))
                    capacity = whValue / 1000  // Convert to kWh
                    console.log('Capacity found in table:', whValue, 'Wh =', capacity, 'kWh')
                    break
                  }
                }
              }
            } catch (e) {
              // Skip problematic rows
            }
          }
          if (capacity !== null) break
        }
      }
      
    } else {
      console.log('Battery section not found in Device Parameters')
    }
    
  } catch (e) {
    console.log('Error getting battery capacity:', e)
  }
  
  if (capacity === null) {
    console.log('Could not determine battery capacity from device parameters')
  }

  console.log('Capacity', capacity || 'unknown')
  return capacity
}

exports.checkChargingState = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  try {
    console.log('=== CHECKING BATTERY CHARGING STATE FROM PARAMETERS ===')
    
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
    
    // Navigate to Device Parameters
    console.log('Navigating to Device Parameters...')
    await page.click('#lDeviceParameter', { timeout: 30000 })
    
    console.log('Clicking Parameter Edit...')
    await page.click('#bParameterEdit', { timeout: 20000 })
    
    const batterySection = page.locator('span', {
      hasText: 'Battery'
    }).first()
    await batterySection.click({ timeout: 15000 })
    
    // Look for the self-consumption parameter
    console.log('Looking for self-consumption parameter...')
    const selfConsumption = page.locator('td', {
      hasText: 'Minimum width of self-consumption area'
    })
    
    const selfConsumptionRow = await selfConsumption.locator('..').first()
    const selfConsumptionInput = await selfConsumptionRow.locator('input').first()
    
    // Read the current value
    const currentValue = await selfConsumptionInput.inputValue({ timeout: 20000 })
    console.log(`Current self-consumption parameter value: "${currentValue}"`)
    
    // Determine if battery is in force charge mode
    // Value "1" = Force charge mode
    // Value "91" = Normal/stop charge mode
    const isCharging = currentValue === '1'
    console.log(`Battery charging state: ${isCharging ? 'CHARGING (force mode)' : 'NOT CHARGING (normal mode)'}`)
    
    return isCharging
    
  } catch (error) {
    console.log('Error checking charging state:', error.message)
    return null
  }
}

exports.getAllInverterData = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})
  
  const result = {
    stateOfCharge: null,
    consumption: null,
    capacity: null,
    isCharging: null,
    pvGeneration: null,
    purchasedElectricity: null,
    batteryCharging: null
  }

  try {
    console.log('=== GETTING SOC AND CAPACITY FROM SMA INVERTER ONLY ===')
    
    // Get SOC from inverter
    try {
      console.log(`--- Getting SOC from inverter at ${process.env.inverterIP} ---`)
      
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
      
      // Navigate to Spot Values
      await page.click('#lSpotValues', { timeout: 30000 })
      await page.waitForTimeout(5000)
      
      // Get SOC only from Battery section
      const batterySection = page.locator('span', { hasText: 'Battery' }).first()
      if (await batterySection.count() > 0) {
        await batterySection.click({ timeout: 20000 })
        await page.waitForTimeout(5000)
        
        const rows = await page.locator('tr').all()
        for (const row of rows) {
          try {
            const rowText = await row.innerText()
            const cleanText = rowText.replace(/\s+/g, ' ').trim()
            
            if (cleanText.includes('State of charge')) {
              const match = cleanText.match(/State of charge\s+(\d+)\s*%/)
              if (match) {
                result.stateOfCharge = parseInt(match[1])
                console.log(`✅ SOC from inverter: ${result.stateOfCharge}%`)
                break
              }
            }
          } catch (e) {
            // Skip problematic rows
          }
        }
      }
      
      console.log(`✅ SOC extraction complete: ${result.stateOfCharge}%`)
      
    } catch (e) {
      console.log(`❌ Could not get SOC from inverter: ${e.message}`)
    }
    
    // Set reasonable battery capacity (this is configured, not dynamic)
    result.capacity = 31.2 // kWh - adjust to your actual battery size
    console.log(`✅ Using configured battery capacity: ${result.capacity} kWh`)
    
    // Check charging state by reading the self-consumption parameter
    try {
      console.log('--- Checking charging state from parameters ---')
      result.isCharging = await exports.checkChargingState(page)
      console.log(`✅ Charging state detected: ${result.isCharging}`)
    } catch (e) {
      console.log(`❌ Could not check charging state: ${e.message}`)
      result.isCharging = null
    }

  } catch (e) {
    console.log('Error in getAllInverterData:', e.message)
  }

  console.log('AllData', JSON.stringify(result, null, 2))
  return result
}

exports.getForecastData = async function (page) {
  await page.setViewportSize({width: 1920, height: 1080})
  
  try {
    console.log('Navigating to Sunny Portal...')
    await page.goto(process.env.SUNNY_PORTAL_URL || 'https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    
    console.log('Checking for redirects and login form...')
    
    // Check current URL to see if we need to initiate login
    const currentUrl = page.url()
    console.log('Current URL after navigation:', currentUrl)
    
    // If we're on an error page, we need to go back to homepage and start proper OAuth flow
    if (currentUrl.includes('error=login_required') || currentUrl.includes('SilentLogin=true')) {
      console.log('Detected login required, navigating to clean homepage to start proper OAuth flow...')
      await page.goto('https://www.sunnyportal.com/', { timeout: 30000, waitUntil: 'load' })
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      console.log('Now on homepage:', page.url())
    }
    
    // Wait a bit for any redirects to complete
    await page.waitForTimeout(3000)
    
    // Handle cookie consent first
    console.log('Checking for cookie consent...')
    try {
      const cookieAcceptSelectors = [
        'button:has-text("Accept all")',
        'button:has-text("Accept")', 
        'button:has-text("OK")',
        '#cookie-accept',
        '.cookie-accept'
      ]
      
      for (const selector of cookieAcceptSelectors) {
        try {
          const cookieButton = page.locator(selector)
          if (await cookieButton.count() > 0) {
            console.log(`Found and clicking cookie accept button: ${selector}`)
            await cookieButton.click()
            await page.waitForTimeout(1000)
            break
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    } catch (e) {
      console.log('No cookie consent found or error handling it:', e.message)
    }
    
    // Check if we got redirected to the SMA login system
    console.log('Current URL after cookie handling:', page.url())
    
    console.log('Looking for login button on homepage...')
    
    // Look for the Login button on the Sunny Portal homepage using the specific ID pattern
    let loginPageButton = null
    const possibleHomeLoginSelectors = [
      '*[id$="SmaIdLoginButton"]',  // Use $ for ends-with to match the pattern better
      '*[id*="SmaIdLoginButton"]',
      'input[id*="SmaIdLoginButton"]',
      'button[id*="SmaIdLoginButton"]',
      'a[id*="SmaIdLoginButton"]',
      'a:has-text("Login")',
      'button:has-text("Login")',
      'input[value="Login"]',
      '*[href*="login"]',
      '*[onclick*="login"]'
    ]
    
    for (const selector of possibleHomeLoginSelectors) {
      try {
        console.log(`Trying homepage login selector: ${selector}`)
        await page.waitForSelector(selector, { timeout: 5000 })
        loginPageButton = page.locator(selector)
        if (await loginPageButton.count() > 0) {
          console.log(`Found homepage login button with selector: ${selector}`)
          break
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (loginPageButton) {
      console.log('Clicking homepage login button to start OAuth flow...')
      // Wait for navigation after clicking the login button
      try {
        await Promise.all([
          page.waitForNavigation({ timeout: 30000 }),
          loginPageButton.click()
        ])
        console.log('Homepage login button clicked and navigated to:', page.url())
      } catch (e) {
        console.log('Navigation timeout after clicking login, trying fallback...')
        await loginPageButton.click()
        await page.waitForTimeout(5000)
        console.log('Current URL after fallback click:', page.url())
      }
    } else {
      console.log('Could not find homepage login button, might already be on login page')
    }
    
    console.log('Looking for login form...')
    
    // Try multiple possible selectors for the modern SMA login system
    const possibleUsernameSelectors = [
      'input[name="username"]',
      'input[name="email"]', 
      'input[type="email"]',
      'input[id="username"]',
      'input[id="email"]',
      'input[placeholder*="Email"]',
      'input[placeholder*="email"]',
      'input[placeholder*="Username"]',
      'input[placeholder*="username"]',
      'input[data-testid="username"]',
      'input[data-testid="email"]',
      '#username',
      '#email',
      '.username-input',
      '.email-input'
    ]
    
    let usernameInput = null
    let usernameSelector = null
    
    for (const selector of possibleUsernameSelectors) {
      try {
        console.log(`Trying username selector: ${selector}`)
        await page.waitForSelector(selector, { timeout: 3000 })
        usernameInput = page.locator(selector)
        if (await usernameInput.count() > 0) {
          usernameSelector = selector
          console.log(`Found username field with selector: ${selector}`)
          break
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!usernameInput) {
      // Take a screenshot to see what we're dealing with
      await page.screenshot({ path: 'login-page-debug.png', fullPage: true })
      console.log('Login page screenshot saved as login-page-debug.png')
      
      // Try to find any input fields
      const allInputs = await page.locator('input').all()
      console.log(`Found ${allInputs.length} input fields on the page`)
      
      for (let i = 0; i < allInputs.length; i++) {
        try {
          const input = allInputs[i]
          const type = await input.getAttribute('type')
          const name = await input.getAttribute('name')
          const id = await input.getAttribute('id')
          const placeholder = await input.getAttribute('placeholder')
          console.log(`Input ${i}: type=${type}, name=${name}, id=${id}, placeholder=${placeholder}`)
        } catch (e) {
          console.log(`Could not get attributes for input ${i}`)
        }
      }
      
      throw new Error('Could not find username/email input field')
    }
    
    console.log('Filling login credentials...')
    console.log('Username field found, filling with username...')
    await usernameInput.fill(process.env.SUNNY_PORTAL_USERNAME)
    
    // Add a small delay
    await page.waitForTimeout(1000)
    
    // Look for password field
    const possiblePasswordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[id="password"]',
      'input[placeholder*="Password"]',
      'input[placeholder*="password"]',
      'input[data-testid="password"]',
      '#password',
      '.password-input'
    ]
    
    let passwordInput = null
    
    for (const selector of possiblePasswordSelectors) {
      try {
        console.log(`Trying password selector: ${selector}`)
        await page.waitForSelector(selector, { timeout: 3000 })
        passwordInput = page.locator(selector)
        if (await passwordInput.count() > 0) {
          console.log(`Found password field with selector: ${selector}`)
          break
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!passwordInput) {
      throw new Error('Could not find password input field')
    }
    
    console.log('Password field found, filling with password...')
    await passwordInput.fill(process.env.SUNNY_PORTAL_PASSWORD)
    
    // Add a small delay
    await page.waitForTimeout(1000)
    
    // Take a screenshot before submitting to debug
    await page.screenshot({ path: 'before-login-submit.png', fullPage: true })
    console.log('Pre-submit screenshot saved as before-login-submit.png')
    
    // Find and click login button - using the exact text from the screenshot
    const possibleLoginButtonSelectors = [
      'button:has-text("Log in")',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button:has-text("Sign In")',
      'button:has-text("Anmelden")',
      'button[data-testid="login"]',
      'button[data-testid="submit"]',
      '.login-button',
      '.submit-button'
    ]
    
    let loginButton = null
    
    for (const selector of possibleLoginButtonSelectors) {
      try {
        console.log(`Trying login button selector: ${selector}`)
        loginButton = page.locator(selector)
        if (await loginButton.count() > 0) {
          console.log(`Found login button with selector: ${selector}`)
          break
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!loginButton) {
      // Look for any buttons on the page
      const allButtons = await page.locator('button').all()
      console.log(`Found ${allButtons.length} buttons on the page`)
      
      for (let i = 0; i < allButtons.length; i++) {
        try {
          const button = allButtons[i]
          const text = await button.innerText()
          const type = await button.getAttribute('type')
          const className = await button.getAttribute('class')
          console.log(`Button ${i}: text="${text}", type=${type}, class=${className}`)
        } catch (e) {
          console.log(`Could not get attributes for button ${i}`)
        }
      }
      
      throw new Error('Could not find login button')
    }
    
    console.log('Clicking login button...')
    
    // Handle potential navigation during login
    try {
      await Promise.all([
        page.waitForNavigation({ timeout: 30000 }),
        loginButton.click()
      ])
      console.log('Login button clicked and navigation completed')
    } catch (e) {
      console.log('Navigation error or timeout during login:', e.message)
      // Try alternative approach - just click and wait
      try {
        await loginButton.click()
        await page.waitForTimeout(5000)
        console.log('Used fallback click method')
      } catch (e2) {
        console.log('Fallback click also failed:', e2.message)
      }
    }
    
    // Check if we're still on the same page or got redirected
    try {
      const currentUrl = page.url()
      console.log('Current URL after login attempt:', currentUrl)
      
      // Check for login errors on the page
      const loginError = await page.locator('*:has-text("Login Failed"), *:has-text("Invalid"), *:has-text("Error")').first()
      if (await loginError.count() > 0) {
        const errorText = await loginError.innerText()
        console.log('Login error detected:', errorText)
      }
      
      // If we're still on the login page, there might be an issue
      if (currentUrl.includes('login.sma.energy')) {
        console.log('Still on login page, might be an authentication issue')
      }
      
      console.log('Waiting for page to stabilize...')
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      
    } catch (e) {
      console.log('Error checking post-login state:', e.message)
      throw new Error('Login process failed or browser context was closed')
    }
    
    // Take a screenshot after login to see the dashboard
    await page.screenshot({ path: 'after-login.png', fullPage: true })
    console.log('Post-login screenshot saved as after-login.png')
    
    // Debug: Look for any navigation or sidebar elements
    console.log('Looking for navigation elements...')
    const allLinks = await page.locator('a').all()
    console.log(`Found ${allLinks.length} links on the page`)
    
    for (let i = 0; i < Math.min(allLinks.length, 10); i++) {
      try {
        const link = allLinks[i]
        const text = await link.innerText()
        const href = await link.getAttribute('href')
        if (text && text.trim().length > 0 && text.trim().length < 50) {
          console.log(`Link ${i}: "${text.trim()}" -> ${href}`)
        }
      } catch (e) {
        // Skip problematic links
      }
    }
    
    console.log('Navigating to forecast page via sidebar...')
    
    // Look for the "Current Status and Forecast" link in the left sidebar
    const forecastLinkSelectors = [
      'a:has-text("Current Status and Forecast")',
      'a:has-text("Current Status")',
      'a:has-text("Forecast")',
      'a[href*="HoManLive"]',
      'a[href*="forecast"]',
      'a[href*="status"]',
      '*:has-text("Current Status and Forecast")'
    ]
    
    let forecastLink = null
    
    for (const selector of forecastLinkSelectors) {
      try {
        console.log(`Trying forecast link selector: ${selector}`)
        await page.waitForSelector(selector, { timeout: 5000 })
        forecastLink = page.locator(selector)
        if (await forecastLink.count() > 0) {
          console.log(`Found forecast link with selector: ${selector}`)
          break
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (forecastLink) {
      console.log('Clicking forecast link...')
      await forecastLink.click()
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      console.log('Current URL after clicking forecast link:', page.url())
    } else {
      console.log('Could not find forecast link, trying direct navigation...')
      await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx')
      await page.waitForLoadState('networkidle', { timeout: 30000 })
    }
    
    console.log('Looking for forecast data and current status...')
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'forecast-page.png', fullPage: true })
    console.log('Screenshot saved as forecast-page.png')
    
    // Extract current status values from Sunny Portal (visible on the Current Status page)
    const currentStatus = {
      pvGeneration: null,
      consumption: null,  
      purchasedElectricity: null,
      batteryCharging: null,
      batterySOC: null
    }
    
    console.log('Extracting current status values from Sunny Portal...')
    
    try {
      // Look for the current status tiles/cards that show power values
      const statusElements = await page.locator('*:has-text("kW"), *:has-text("kw")').all()
      console.log('Found', statusElements.length, 'elements with kW values')
      
      for (let i = 0; i < Math.min(statusElements.length, 20); i++) {
        try {
          const element = statusElements[i]
          const text = await element.innerText()
          const cleanText = text.trim()
          
          // Look for power generation
          if (cleanText.match(/PV.*generation|generation.*PV|solar.*power/i)) {
            const powerMatch = cleanText.match(/(\d+\.?\d*)\s*kW/i)
            if (powerMatch) {
              currentStatus.pvGeneration = parseFloat(powerMatch[1]) * 1000 // Convert to watts
              console.log('Found PV generation:', currentStatus.pvGeneration, 'W')
            }
          }
          
          // Look for total consumption  
          else if (cleanText.match(/total.*consumption|consumption.*total/i)) {
            const powerMatch = cleanText.match(/(\d+\.?\d*)\s*kW/i)
            if (powerMatch) {
              currentStatus.consumption = parseFloat(powerMatch[1]) * 1000 // Convert to watts
              console.log('Found consumption:', currentStatus.consumption, 'W')
            }
          }
          
          // Look for purchased electricity/grid feed
          else if (cleanText.match(/purchased.*electricity|grid.*feed|feed.*in/i)) {
            const powerMatch = cleanText.match(/(\d+\.?\d*)\s*kW/i)
            if (powerMatch) {
              currentStatus.purchasedElectricity = parseFloat(powerMatch[1]) * 1000 // Convert to watts
              console.log('Found purchased electricity:', currentStatus.purchasedElectricity, 'W')
            }
          }
          
          // Look for battery charging
          else if (cleanText.match(/battery.*charging|charging.*battery/i)) {
            const powerMatch = cleanText.match(/(\d+\.?\d*)\s*kW/i)
            if (powerMatch) {
              currentStatus.batteryCharging = parseFloat(powerMatch[1]) * 1000 // Convert to watts
              console.log('Found battery charging:', currentStatus.batteryCharging, 'W')
            }
          }
          
        } catch (e) {
          // Skip problematic elements
        }
      }
      
      // Also look for battery state of charge percentage
      const percentElements = await page.locator('*:has-text("%")').all()
      for (const element of percentElements) {
        try {
          const text = await element.innerText()
          if (text.match(/battery.*state|state.*charge|battery.*charge/i)) {
            const socMatch = text.match(/(\d+)\s*%/)
            if (socMatch) {
              currentStatus.batterySOC = parseInt(socMatch[1])
              console.log('Found battery SOC:', currentStatus.batterySOC, '%')
            }
          }
        } catch (e) {
          // Skip
        }
      }
      
    } catch (e) {
      console.log('Error extracting current status from Sunny Portal:', e.message)
    }
    
    // Look for forecast and recommended action section
    const forecastSections = await page.locator('*:has-text("Forecast"), *:has-text("forecast"), *:has-text("Recommended Action"), *:has-text("recommended action")').all()
    console.log('Found', forecastSections.length, 'potential forecast sections')
    
    // Look for chart/graph elements
    const chartElements = await page.locator('canvas, svg, .chart, .graph, [id*="chart"], [class*="chart"], [id*="graph"], [class*="graph"]').all()
    console.log('Found', chartElements.length, 'potential chart elements')
    
    // Try to find data in page content or JavaScript variables
    const pageContent = await page.content()
    
    // Look for common forecast data patterns in the page
    const forecastPatterns = [
      /forecast[^}]*kWh?/gi,
      /prediction[^}]*kWh?/gi,
      /generation[^}]*kWh?/gi,
      /estimated[^}]*kWh?/gi,
      /["']forecast["'][^}]*["']data["']/gi,
      /["']prediction["'][^}]*["']data["']/gi
    ]
    
    let forecastDataFound = []
    
    for (const pattern of forecastPatterns) {
      const matches = pageContent.match(pattern)
      if (matches) {
        forecastDataFound.push(...matches)
      }
    }
    
    console.log('Forecast data patterns found:', forecastDataFound.length)
    for (const data of forecastDataFound) {
      console.log('Forecast pattern:', data.substring(0, 200) + (data.length > 200 ? '...' : ''))
    }
    
    // Try to execute JavaScript to get forecast data
    const jsData = await page.evaluate(() => {
      // Look for common global variables that might contain forecast data
      const possibleVars = ['forecastData', 'chartData', 'graphData', 'predictionData', 'generationData']
      const foundData = {}
      
      for (const varName of possibleVars) {
        try {
          if (window[varName] !== undefined) {
            foundData[varName] = window[varName]
          }
        } catch (e) {
          // Variable doesn't exist
        }
      }
      
      // Also try to find chart.js or other chart library data
      if (window.Chart && window.Chart.instances) {
        foundData.chartInstances = Object.keys(window.Chart.instances).length
      }
      
      return foundData
    })
    
    console.log('JavaScript data found:', JSON.stringify(jsData, null, 2))
    
    // Look for specific elements that might contain forecast values
    const forecastElements = await page.locator('*:has-text("kWh"), *:has-text("kW"), *[data-value], *[data-forecast]').all()
    console.log('Found', forecastElements.length, 'elements with energy values')
    
    const energyValues = []
    for (let i = 0; i < Math.min(forecastElements.length, 20); i++) {
      try {
        const element = forecastElements[i]
        const text = await element.innerText()
        if (text.match(/\d+\.?\d*\s*(kWh?|MWh?)/i)) {
          energyValues.push(text.trim())
        }
      } catch (e) {
        // Skip problematic elements
      }
    }
    
    console.log('Energy values found on page:', energyValues)
    
    // Try to find the specific "Forecast and Recommended Action" section
    let forecastSum = 0
    const forecastText = await page.locator('*:has-text("Forecast and Recommended Action")').first()
    
    if (await forecastText.count() > 0) {
      console.log('Found "Forecast and Recommended Action" section')
      
      // Since the forecast chart is visual, let's try to extract any numerical data from the entire page
      // that might be related to forecast generation for the remainder of the day
      
      try {
        // Look for any JavaScript variables that might contain forecast data
        const forecastData = await page.evaluate(() => {
          // Try to find forecast-related data in global variables
          const possibleVars = [
            'forecastData', 
            'chartData', 
            'graphData', 
            'predictionData', 
            'generationForecast',
            'pvForecast',
            'solarForecast'
          ]
          
          let foundData = {}
          
          for (const varName of possibleVars) {
            try {
              if (window[varName] !== undefined) {
                foundData[varName] = window[varName]
              }
            } catch (e) {
              // Variable doesn't exist
            }
          }
          
          // Also check if there are any data attributes or text content with forecast values
          const elements = document.querySelectorAll('*[data-forecast], *[data-generation], *[data-prediction]')
          if (elements.length > 0) {
            foundData.dataElements = Array.from(elements).map(el => ({
              tagName: el.tagName,
              textContent: el.textContent,
              dataset: el.dataset
            }))
          }
          
          return foundData
        })
        
        console.log('Forecast JavaScript data:', JSON.stringify(forecastData, null, 2))
        
        // For now, since we can see this is working but the specific forecast data extraction 
        // is complex, let's use a reasonable estimate based on current generation
        // In practice, you might need to analyze the chart more deeply or find specific API calls
        
        // From the screenshot, I can see there's a forecast chart with weather icons
        // A reasonable approach would be to:
        // 1. Get current PV generation (1.84 kW from screenshot)
        // 2. Estimate remaining daylight hours 
        // 3. Calculate approximate remaining generation
        
        const currentTime = new Date()
        const currentHour = currentTime.getHours()
        const remainingDaylightHours = Math.max(0, 18 - currentHour) // Assume sunset around 6 PM
        
        // This is a simple estimation - in production you'd want more sophisticated parsing
        if (remainingDaylightHours > 0) {
          // Rough estimate: assume declining generation through the day
          forecastSum = remainingDaylightHours * 0.5 // Conservative estimate
          console.log(`Estimated forecast: ${remainingDaylightHours} hours remaining, ~${forecastSum} kWh`)
        }
        
      } catch (e) {
        console.log('Error extracting forecast data:', e.message)
      }
    }
    
    console.log('Calculated forecast sum:', forecastSum, 'kWh')
    
    return {
      forecastSum,
      energyValues,
      forecastDataFound: forecastDataFound.length,
      jsData,
      timestamp: new Date().toISOString(),
      currentStatus
    }
    
  } catch (error) {
    console.log('Error getting forecast data:', error.message)
    
    // Take a screenshot for debugging
    try {
      await page.screenshot({ path: 'forecast-error.png', fullPage: true })
      console.log('Error screenshot saved as forecast-error.png')
    } catch (screenshotError) {
      console.log('Could not take error screenshot:', screenshotError.message)
    }
    
    throw error
  }
}

exports.getCurrentStatusFromSunnyPortal = async function (page) {
  await page.setViewportSize({width: 1920, height: 1080})
  
  const result = {
    pvGeneration: null,
    consumption: null,  
    purchasedElectricity: null,
    batteryCharging: null
  }
  
  try {
    console.log('=== GETTING CURRENT STATUS FROM SUNNY PORTAL ===')
    
    // The page should already be logged in from forecast data collection
    console.log('Current URL:', page.url())
    
    // Navigate to the live data page to get current status values
    console.log('Navigating to Current Status page...')
    
    try {
      // Look for "Current Status and Forecast" or similar link in sidebar
      const statusLinks = [
        'a:has-text("Current Status and Forecast")',
        'a:has-text("Current Status")', 
        'a:has-text("Live Data")',
        'a:has-text("Dashboard")',
        '*[href*="HoManLive"]',
        '*[href*="live"]',
        '*[href*="status"]'
      ]
      
      let statusLink = null
      
      for (const selector of statusLinks) {
        try {
          statusLink = page.locator(selector).first()
          if (await statusLink.count() > 0) {
            console.log(`Found status link with selector: ${selector}`)
            await statusLink.click()
            await page.waitForTimeout(3000)
            break
          }
        } catch (e) {
          // Continue
        }
      }
      
      if (!statusLink || await statusLink.count() === 0) {
        console.log('No status link found, trying direct navigation...')
        // Try direct navigation to the live data page
        const baseUrl = page.url().split('/')[0] + '//' + page.url().split('/')[2]
        await page.goto(baseUrl + '/FixedPages/HoManLive.aspx')
        await page.waitForTimeout(3000)
      }
      
    } catch (e) {
      console.log('Error navigating to status page:', e.message)
    }
    
    console.log('Current URL after navigation to status:', page.url())
    await page.screenshot({ path: 'sunny-portal-status.png', fullPage: true })
    console.log('Status page screenshot saved')
    
    // Extract current power values from the live data page
    console.log('Extracting current power values from Sunny Portal...')
    
    try {
      // Wait for initial page load
      await page.waitForTimeout(5000)
      
      // Wait up to 30 seconds for power values to appear on the page
      console.log('Waiting for power values to load (up to 30 seconds)...')
      
      let powerValuesFound = false
      const maxWaitTime = 30000 // 30 seconds
      const checkInterval = 2000 // Check every 2 seconds
      let waitTime = 0
      
      while (!powerValuesFound && waitTime < maxWaitTime) {
        // Look for any elements with power values (kW or W)
        const powerElements = await page.locator('*:has-text("kW"), *:has-text(" W"), *:has-text("MW")').all()
        console.log(`Check ${Math.floor(waitTime/1000)}s: Found ${powerElements.length} elements with power units`)
        
        if (powerElements.length > 3) { // Expect at least a few power values
          powerValuesFound = true
          console.log('✅ Power values detected on page')
          break
        }
        
        await page.waitForTimeout(checkInterval)
        waitTime += checkInterval
        
        // Try refreshing or reloading if needed
        if (waitTime === 10000) { // After 10 seconds, try a refresh
          console.log('Refreshing page to load latest data...')
          await page.reload({ waitUntil: 'networkidle' })
          await page.waitForTimeout(3000)
        }
      }
      
      if (!powerValuesFound) {
        console.log('⚠️ Timeout waiting for power values to load')
      }
      
      // Now extract the power values with multiple strategies
      console.log('=== Strategy 1: Looking for prominent display values ===')
      
      // Look for large display values that are typically shown prominently
      const displaySelectors = [
        '*[class*="value"]',
        '*[class*="display"]', 
        '*[class*="current"]',
        '*[class*="live"]',
        '*[class*="power"]',
        'span:has-text("kW")',
        'div:has-text("kW")',
        'td:has-text("kW")'
      ]
      
      const foundValues = []
      
      for (const selector of displaySelectors) {
        try {
          const elements = await page.locator(selector).all()
          console.log(`Selector ${selector}: ${elements.length} elements`)
          
          for (let i = 0; i < Math.min(elements.length, 10); i++) {
            try {
              const element = elements[i]
              const text = await element.innerText()
              const cleanText = text.replace(/\s+/g, ' ').trim()
              
              if (cleanText.match(/\d+[.,]?\d*\s*(k?W|MW)/i) && cleanText.length < 100) {
                foundValues.push({
                  text: cleanText,
                  selector: selector,
                  element: i
                })
                console.log(`  Found: "${cleanText}"`)
              }
            } catch (e) {
              // Skip problematic elements
            }
          }
        } catch (e) {
          // Skip problematic selectors
        }
      }
      
      console.log(`\n=== Strategy 2: Scanning all power-related text ===`)
      
      // Get all text content and look for power patterns
      const pageText = await page.textContent('body')
      const powerPatterns = [
        /(?:PV|Solar|Generation|Photovoltaic).*?([0-9.,]+)\s*(k?W|MW)/gi,
        /(?:Consumption|Load|Usage|Demand).*?([0-9.,]+)\s*(k?W|MW)/gi,
        /(?:Grid|Purchase|Import|Feed|Export).*?([0-9.,]+)\s*(k?W|MW)/gi,
        /(?:Battery|Charge|Storage|Charging).*?([0-9.,]+)\s*(k?W|MW)/gi
      ]
      
      const categories = ['PV Generation', 'Consumption', 'Grid Power', 'Battery Power']
      
      powerPatterns.forEach((pattern, idx) => {
        let match
        while ((match = pattern.exec(pageText)) !== null) {
          let power = parseFloat(match[1].replace(',', '.'))
          if (match[2].toLowerCase().includes('k')) {
            power *= 1000 // Convert kW to W
          } else if (match[2].toLowerCase().includes('m')) {
            power *= 1000000 // Convert MW to W
          }
          
          console.log(`${categories[idx]} pattern match: ${match[0]} = ${power} W`)
          
          // Assign to result based on category
          if (idx === 0 && !result.pvGeneration) {
            result.pvGeneration = power
            console.log(`✅ PV Generation: ${result.pvGeneration} W`)
          } else if (idx === 1 && !result.consumption) {
            result.consumption = power
            console.log(`✅ Total Consumption: ${result.consumption} W`)
          } else if (idx === 2 && !result.purchasedElectricity) {
            result.purchasedElectricity = power
            console.log(`✅ Purchased Electricity: ${result.purchasedElectricity} W`)
          } else if (idx === 3 && !result.batteryCharging) {
            result.batteryCharging = power
            console.log(`✅ Battery Charging: ${result.batteryCharging} W`)
          }
        }
      })
      
      console.log(`\n=== Strategy 3: Structured data extraction ===`)
      
      // Look for structured data in tables or lists
      const structuredElements = await page.locator('table, ul, ol, .data-table, .summary, .overview').all()
      console.log(`Found ${structuredElements.length} structured elements`)
      
      for (const element of structuredElements) {
        try {
          const text = await element.innerText()
          const lines = text.split('\n')
          
          for (const line of lines) {
            const cleanLine = line.trim()
            if (cleanLine.includes('kW') || cleanLine.includes(' W')) {
              console.log(`Structured data: "${cleanLine}"`)
              
              // Extract power values from structured data
              const powerMatch = cleanLine.match(/([0-9.,]+)\s*(k?W|MW)/i)
              if (powerMatch) {
                let power = parseFloat(powerMatch[1].replace(',', '.'))
                if (powerMatch[2].toLowerCase().includes('k')) {
                  power *= 1000
                } else if (powerMatch[2].toLowerCase().includes('m')) {
                  power *= 1000000
                }
                
                const lowerLine = cleanLine.toLowerCase()
                
                // More specific matching
                if ((lowerLine.includes('pv') || lowerLine.includes('solar') || lowerLine.includes('generation')) && !result.pvGeneration) {
                  result.pvGeneration = power
                  console.log(`✅ PV Generation (structured): ${result.pvGeneration} W`)
                } else if ((lowerLine.includes('consumption') || lowerLine.includes('load') || lowerLine.includes('demand')) && !result.consumption) {
                  result.consumption = power
                  console.log(`✅ Consumption (structured): ${result.consumption} W`)
                } else if ((lowerLine.includes('grid') || lowerLine.includes('purchase') || lowerLine.includes('import')) && !result.purchasedElectricity) {
                  result.purchasedElectricity = power
                  console.log(`✅ Purchased Electricity (structured): ${result.purchasedElectricity} W`)
                } else if ((lowerLine.includes('battery') || lowerLine.includes('charg') || lowerLine.includes('storage')) && !result.batteryCharging) {
                  result.batteryCharging = power
                  console.log(`✅ Battery Charging (structured): ${result.batteryCharging} W`)
                }
              }
            }
          }
        } catch (e) {
          // Skip problematic structured elements
        }
      }
      
      // Final attempt: Look for any numeric values that might be power readings
      if (!result.pvGeneration && !result.consumption && !result.purchasedElectricity && !result.batteryCharging) {
        console.log(`\n=== Strategy 4: Fallback - extracting any significant power values ===`)
        
        const allPowerValues = foundValues.concat(
          pageText.match(/\d+[.,]?\d*\s*(k?W|MW)/gi) || []
        )
        
        console.log('All power values found:')
        allPowerValues.forEach((value, idx) => {
          if (idx < 15) {
            const text = typeof value === 'string' ? value : value.text
            console.log(`  ${idx + 1}: "${text}"`)
          }
        })
        
        // Try to assign the most reasonable values based on magnitude
        const significantValues = allPowerValues
          .map(v => {
            const text = typeof v === 'string' ? v : v.text
            const match = text.match(/([0-9.,]+)\s*(k?W|MW)/i)
            if (match) {
              let power = parseFloat(match[1].replace(',', '.'))
              if (match[2].toLowerCase().includes('k')) {
                power *= 1000
              } else if (match[2].toLowerCase().includes('m')) {
                power *= 1000000
              }
              return { text, power }
            }
            return null
          })
          .filter(v => v && v.power > 0 && v.power < 50000) // Reasonable range for home system
          .sort((a, b) => b.power - a.power) // Sort by power descending
        
        console.log('Significant power values (filtered and sorted):')
        significantValues.forEach((value, idx) => {
          console.log(`  ${idx + 1}: ${value.text} = ${value.power} W`)
        })
        
        // Assign based on typical magnitude expectations
        if (significantValues.length > 0) {
          // Largest value is likely consumption or generation
          if (!result.consumption && significantValues[0]) {
            result.consumption = significantValues[0].power
            console.log(`✅ Consumption (fallback): ${result.consumption} W`)
          }
          
          // Second largest might be PV generation
          if (!result.pvGeneration && significantValues[1]) {
            result.pvGeneration = significantValues[1].power
            console.log(`✅ PV Generation (fallback): ${result.pvGeneration} W`)
          }
          
          // Third might be battery charging
          if (!result.batteryCharging && significantValues[2]) {
            result.batteryCharging = significantValues[2].power
            console.log(`✅ Battery Charging (fallback): ${result.batteryCharging} W`)
          }
          
          // Calculate purchased electricity if we have consumption and PV
          if (result.consumption && result.pvGeneration && !result.purchasedElectricity) {
            result.purchasedElectricity = Math.max(0, result.consumption - result.pvGeneration)
            console.log(`✅ Purchased Electricity (calculated): ${result.purchasedElectricity} W`)
          }
        }
      }
      
    } catch (e) {
      console.log('Error extracting power values:', e.message)
    }
    
    console.log('Sunny Portal current status extraction completed')
    console.log('Final result:', JSON.stringify(result, null, 2))
    return result
    
  } catch (error) {
    console.error('Error getting current status from Sunny Portal:', error.message)
    return result // Return partial results
  }
}

exports.checkForceChargingFromSunnyPortal = async function (page) {
  try {
    console.log('🔍 Checking force charging windows on Sunny Portal...')
    
    // Go to Plant Formula Configuration page
    await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    // Check for existing charging windows
    const removeButtons = page.locator('img[src="../Tools/images/buttons/remove_segment_btn.png"]')
    const windowCount = await removeButtons.count()
    
    console.log('FORCE_CHARGE_WINDOWS_FOUND:', windowCount)
    console.log(`✅ Force charging check: ${windowCount} time windows found - Force charging is ${windowCount > 0 ? 'ON' : 'OFF'}`)
    
    return windowCount
    
  } catch (error) {
    console.error('Error checking force charge state:', error.message)
    console.log('FORCE_CHARGE_WINDOWS_FOUND: ERROR')
    throw error
  }
}