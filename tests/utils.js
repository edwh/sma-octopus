const {expect} = require('@playwright/test')

exports.getForecastData = async function (page) {
  await page.setViewportSize({width: 1920, height: 1080})
  
  try {
    console.log('Navigating to Sunny Portal...')
    
    // Start on main page to ensure clean state
    console.log('📡 Loading Sunny Portal homepage...')
    await page.goto('https://www.sunnyportal.com/', { timeout: 30000 })
    console.log('✅ Homepage loaded, waiting for network activity to settle...')
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 })
      console.log('✅ DOM content loaded')
    } catch (e) {
      console.log('⚠️ DOM load timeout, continuing anyway...')
    }
    await page.waitForTimeout(2000)
    
    // Handle cookie consent if present
    try {
      const acceptCookies = page.locator('#cmpwelcomebtnyes')
      await acceptCookies.click({ timeout: 5000 })
      console.log('✅ Accepted cookies')
      await page.waitForTimeout(2000)
    } catch (e) {
      console.log('ℹ️ No cookie dialog found or already handled')
    }
    
    // Check for login requirement - if already logged in, this will redirect to dashboard
    let isLoggedIn = false
    try {
      // Look for elements that indicate we're logged in
      await page.waitForSelector('a:has-text("Log out"), .menu, .navigation', { timeout: 5000 })
      isLoggedIn = true
      console.log('Already logged in to Sunny Portal')
    } catch {
      console.log('Need to log in to Sunny Portal')
    }
    
    if (!isLoggedIn) {
      console.log('🔍 Looking for Login button on homepage...')
      
      // Click the Login button on the homepage
      try {
        // Use the specific ID from the DOM structure provided
        await page.click('#ctl00_ContentPlaceHolder1_Logincontrol1_SmaIdLoginButton', { timeout: 10000 })
        console.log('✅ Clicked Login button')
        
        // Wait for redirect to SMA login service
        await page.waitForURL(/login\.sma\.energy/, { timeout: 15000 })
        console.log('✅ Redirected to SMA login service')
        
        // Wait for the login form to load
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 })
        await page.waitForTimeout(3000)
        
      } catch (e) {
        console.log('⚠️ Could not find/click login button, trying direct navigation...')
        await page.goto('https://www.sunnyportal.com/Templates/Start.aspx')
        await page.waitForTimeout(3000)
      }
      
      // Debug: Let's see what's actually on the page
      console.log('🔍 Debugging: Checking current page...')
      const currentUrl = page.url()
      console.log(`Current URL: ${currentUrl}`)
      
      // If we're redirected to SMA login service, handle it properly
      if (currentUrl.includes('login.sma.energy')) {
        console.log('🔄 Detected SMA login service redirect, waiting for page to fully load...')
        await page.waitForTimeout(5000) // Extra wait for SMA login service
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 })
        } catch (e) {
          console.log('⚠️ SMA login service load timeout, continuing...')
        }
      }
      
      // Take a screenshot for debugging
      try {
        await page.screenshot({ path: 'debug-login-page.png', fullPage: true })
        console.log('📸 Screenshot saved: debug-login-page.png')
      } catch (e) {
        console.log('⚠️ Could not save screenshot')
      }
      
      // Look for username/email field
      console.log('Looking for login form...')
      const usernameSelectors = [
        // Standard selectors
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[id*="username"]',
        'input[id*="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]',
        // SMA/Keycloak specific selectors
        'input[name="login"]', 
        'input[id="username"]',
        'input[id="email"]',
        '#username',
        '#email',
        // Generic form selectors
        'form input[type="text"]:first-child',
        'form input:not([type="password"]):not([type="hidden"]):not([type="submit"])',
        // Broader search
        'input[autocomplete*="username"]',
        'input[autocomplete*="email"]'
      ]
      
      let usernameField = null
      for (const selector of usernameSelectors) {
        try {
          console.log(`🔍 Trying username selector: ${selector}`)
          usernameField = page.locator(selector).first()
          await usernameField.waitFor({ timeout: 3000 })
          console.log(`✅ Found username field: ${selector}`)
          break
        } catch (e) {
          console.log(`❌ Failed: ${selector}`)
          usernameField = null
          // Try next selector
        }
      }
      
      if (!usernameField) {
        throw new Error('Could not find username/email field')
      }
      
      // Fill in credentials
      console.log('🔑 About to fill username field...')
      await usernameField.fill(process.env.SUNNY_PORTAL_USERNAME)
      console.log('✅ Filled username')
      
      // Look for password field
      const passwordField = page.locator('input[type="password"]').first()
      await passwordField.waitFor({ timeout: 10000 })
      await passwordField.fill(process.env.SUNNY_PORTAL_PASSWORD)
      console.log('Filled password')
      
      // Submit form
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        '.login-submit',
        'form button'
      ]
      
      for (const selector of submitSelectors) {
        try {
          await page.click(selector, { timeout: 5000 })
          console.log(`Clicked submit button: ${selector}`)
          break
        } catch (e) {
          // Try next selector
        }
      }
      
      // Wait for navigation after login
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      await page.waitForTimeout(5000)
    }
    
    console.log('Logged in successfully, navigating to forecast page...')
    
    // Navigate to the Current Status and Forecast page
    await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx')
    await page.waitForLoadState('networkidle', { timeout: 60000 })
    await page.waitForTimeout(10000)
    
    console.log('Looking for forecast data...')
    
    // Method 1: Look for forecast chart data using various selectors
    const chartSelectors = [
      '.forecast-chart',
      '[id*="forecast" i]',
      '[class*="forecast" i]',
      '.chart-container',
      'svg',
      'canvas'
    ]
    
    let forecastFound = false
    let forecastSum = 0
    
    for (const selector of chartSelectors) {
      try {
        const elements = await page.locator(selector).all()
        if (elements.length > 0) {
          console.log(`Found potential forecast elements: ${selector} (${elements.length})`)
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    // Method 2: Look for JavaScript data or text containing energy values
    console.log('Searching page content for energy values...')
    const pageContent = await page.textContent('body')
    
    // Look for energy values in kWh or Wh
    const energyMatches = pageContent.match(/(\d+(?:\.\d+)?)\s*(?:k?Wh?)\b/gi) || []
    const significantEnergies = []
    
    energyMatches.forEach(match => {
      const value = parseFloat(match.replace(/[^\d.]/g, ''))
      if (value > 0 && value < 100) { // Reasonable range for daily solar generation
        significantEnergies.push(value)
      }
    })
    
    if (significantEnergies.length > 0) {
      const maxValue = Math.max(...significantEnergies)
      const sumValue = significantEnergies.reduce((a, b) => a + b, 0)
      
      console.log(`Energy values found on page: ${significantEnergies.join(', ')} kWh`)
      console.log(`Max value: ${maxValue} kWh, Sum: ${sumValue} kWh`)
      
      // Don't use page content method - it finds wrong values
      // Always proceed to tooltip extraction for accurate hourly data
      console.log(`Page content found values but proceeding to tooltip extraction for accuracy`)
      console.log(`Page values would be: ${sumValue} kWh (but these may not be the correct hourly forecasts)`)
    }
    
    // Method 3: Extract forecast data from tooltips (most accurate method)
    if (!forecastFound) {
      try {
        console.log('Attempting to extract forecast data from tooltips...')
        
        // Target the specific forecast column structure from Sunny Portal
        console.log('Looking for forecast columns with qtip data...')
        const forecastColumns = await page.locator('.forecastColumn[data-hasqtip]').all()
        console.log(`Found ${forecastColumns.length} forecast columns with qtip data`)
        
        // Get current local time from Sunny Portal to filter future hours only
        let currentLocalTime = null
        try {
          const timeIndicator = await page.locator('.timeIndicatorLabel').first()
          const timeText = await timeIndicator.textContent()
          console.log(`Time indicator text: ${timeText}`)
          
          // Extract time from format like "Today - 8:55:04 AM" or "Today - 08:48:07"
          const timeMatch = timeText.match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/)
          if (timeMatch) {
            let hours = parseInt(timeMatch[1])
            const minutes = parseInt(timeMatch[2])
            const period = timeMatch[4]
            
            // Handle AM/PM conversion to 24-hour format
            if (period === 'PM' && hours !== 12) hours += 12
            if (period === 'AM' && hours === 12) hours = 0
            
            currentLocalTime = hours * 100 + minutes // Convert to HHMM format
            console.log(`Current local time: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} (${currentLocalTime})`)
          }
        } catch (e) {
          console.log('Could not extract current time from page, including all forecast hours')
        }
        
        let pvGenerationValues = []
        
        // Hover over each forecast column to trigger its tooltip
        for (let i = 0; i < forecastColumns.length; i++) {
          try {
            console.log(`Hovering over forecast column ${i + 1}/${forecastColumns.length}...`)
            await forecastColumns[i].hover({ timeout: 10000 })
            await page.waitForTimeout(2000) // Wait for tooltip to appear
            
            // Get the qtip ID from the data-hasqtip attribute
            const qtipId = await forecastColumns[i].getAttribute('data-hasqtip')
            console.log(`Column ${i + 1} has qtip ID: ${qtipId}`)
            
            // Look for the corresponding tooltip
            const tooltipSelectors = [
              `#qtip-${qtipId}`,
              `[aria-describedby="qtip-${qtipId}"]`,
              `.qtip[data-qtip-id="${qtipId}"]`,
              `.qtip .forecastTooltip`
            ]
            
            let foundTooltip = false
            for (const selector of tooltipSelectors) {
              try {
                const tooltips = await page.locator(selector).all()
                if (tooltips.length > 0) {
                  console.log(`Found tooltip for column ${i + 1} using selector: ${selector}`)
                  const tooltip = tooltips[0]
                  const text = await tooltip.textContent({ timeout: 5000 })
                  console.log(`Column ${i + 1} tooltip content:`, text.substring(0, 200))
                  
                  // Extract time range from tooltip (e.g., "9:00 AM - 10:00 AM")
                  let includeThisHour = true
                  if (currentLocalTime !== null) {
                    const timeMatch = text.match(/(\d{1,2}):00\s*(AM|PM)\s*-\s*(\d{1,2}):00\s*(AM|PM)/)
                    if (timeMatch) {
                      let startHour = parseInt(timeMatch[1])
                      const startPeriod = timeMatch[2]
                      let endHour = parseInt(timeMatch[3])
                      const endPeriod = timeMatch[4]
                      
                      // Convert to 24-hour format
                      if (startPeriod === 'PM' && startHour !== 12) startHour += 12
                      if (startPeriod === 'AM' && startHour === 12) startHour = 0
                      if (endPeriod === 'PM' && endHour !== 12) endHour += 12
                      if (endPeriod === 'AM' && endHour === 12) endHour = 0
                      
                      const hourStartTime = startHour * 100 // Convert to HHMM format
                      const hourEndTime = endHour * 100 // Convert to HHMM format
                      
                      // Only include hours where the END time hasn't been reached yet
                      // This excludes both past hours and the current hour that's in progress
                      includeThisHour = hourEndTime > currentLocalTime
                      
                      console.log(`Hour ${startHour.toString().padStart(2, '0')}:00-${endHour.toString().padStart(2, '0')}:00 (ends ${hourEndTime}) vs current ${currentLocalTime}: ${includeThisHour ? 'INCLUDE' : 'SKIP'}`)
                    }
                  }
                  
                  if (includeThisHour) {
                    // Look for "Difference:" value (net energy for battery)
                    const differenceMatch = text.match(/Difference.*?(\d+(?:\.\d+)?)\s*kWh/i)
                    if (differenceMatch) {
                      const value = parseFloat(differenceMatch[1])
                      if (!isNaN(value) && value >= 0) { // Allow 0 values
                        pvGenerationValues.push(value)
                        foundTooltip = true
                        console.log(`✅ Column ${i + 1}: Found difference value: ${value} kWh (FUTURE HOUR)`)
                        break // Found what we need for this column
                      }
                    }
                  } else {
                    console.log(`⏰ Column ${i + 1}: Skipping past hour`)
                    foundTooltip = true // Don't try fallback for past hours
                    break
                  }
                  
                  // If no difference found, try PV generation as fallback
                  if (!foundTooltip) {
                    const pvMatch = text.match(/Estimated PV power generation.*?(\d+(?:\.\d+)?)\s*kWh/i)
                    if (pvMatch) {
                      const value = parseFloat(pvMatch[1])
                      if (!isNaN(value) && value >= 0) {
                        pvGenerationValues.push(value)
                        foundTooltip = true
                        console.log(`⚠️ Column ${i + 1}: Using PV generation as fallback: ${value} kWh`)
                        break
                      }
                    }
                  }
                }
              } catch (e) {
                console.log(`Tooltip selector "${selector}" failed: ${e.message}`)
              }
            }
            
            if (!foundTooltip) {
              console.log(`❌ No tooltip found for column ${i + 1}`)
            }
            
          } catch (e) {
            console.log(`Failed to hover over column ${i + 1}: ${e.message}`)
          }
        }
        
        // If we found values in tooltips, sum them up
        if (pvGenerationValues.length > 0) {
          forecastSum = pvGenerationValues.reduce((sum, val) => sum + val, 0)
          forecastFound = true
          console.log(`Extracted ${pvGenerationValues.length} PV generation values from tooltips:`, pvGenerationValues)
          console.log(`Total forecast from tooltips: ${forecastSum} kWh`)
        } else {
          console.log('No PV generation values found in tooltips, trying static tooltip extraction...')
          
          // Try to find tooltips that might already be visible or in DOM
          console.log('Searching for static tooltips in DOM...')
          const staticTooltipSelectors = [
            '.qtip .forecastTooltip',
            '.qtip .tooltipRight',
            '.qtip-content table',
            '.tooltip table',
            '[class*="tooltip"] table',
            '[id*="qtip"] table',
            '.chart-tooltip table',
            '.forecastTooltip',
            'table.forecastTooltip',
            // More aggressive selectors
            '*:contains("Estimated PV power generation")',
            '*:contains("kWh")'
          ]
          
          for (const selector of staticTooltipSelectors) {
            try {
              const tooltips = await page.locator(selector).all()
              console.log(`Static selector "${selector}" found ${tooltips.length} elements`)
              for (const tooltip of tooltips) {
                const text = await tooltip.textContent()
                console.log(`Static tooltip content (${selector}):`, text.substring(0, 300))
                
                // Look for Difference values first (net energy available for battery)
                const differenceMatches = text.match(/Difference.*?(\d+(?:\.\d+)?)\s*kWh/gi)
                if (differenceMatches) {
                  console.log(`Found ${differenceMatches.length} Difference matches in static tooltip:`, differenceMatches)
                  for (const match of differenceMatches) {
                    const valueMatch = match.match(/(\d+(?:\.\d+)?)\s*kWh/i)
                    if (valueMatch) {
                      const value = parseFloat(valueMatch[1])
                      if (!isNaN(value) && value > 0) {
                        pvGenerationValues.push(value)
                        console.log(`✅ Found static difference value: ${value} kWh`)
                      }
                    }
                  }
                } else {
                  // Fallback: Look for PV generation values
                  const pvMatches = text.match(/Estimated PV power generation.*?(\d+(?:\.\d+)?)\s*kWh/gi)
                  if (pvMatches) {
                    console.log(`Found ${pvMatches.length} PV matches in static tooltip:`, pvMatches)
                    for (const match of pvMatches) {
                      const valueMatch = match.match(/(\d+(?:\.\d+)?)\s*kWh/i)
                      if (valueMatch) {
                        const value = parseFloat(valueMatch[1])
                        if (!isNaN(value) && value > 0) {
                          pvGenerationValues.push(value)
                          console.log(`⚠️ Found static PV generation (fallback): ${value} kWh`)
                        }
                      }
                    }
                  } else {
                    // Try to find any kWh values as a broader search
                    const kwhMatches = text.match(/(\d+(?:\.\d+)?)\s*kWh/gi)
                    if (kwhMatches && kwhMatches.length > 0) {
                      console.log(`Found kWh values (no specific label):`, kwhMatches)
                    }
                  }
                }
              }
            } catch (e) {
              console.log(`Static tooltip selector "${selector}" failed:`, e.message)
            }
          }
          
          if (pvGenerationValues.length > 0) {
            forecastSum = pvGenerationValues.reduce((sum, val) => sum + val, 0)
            forecastFound = true
            console.log(`Total forecast from static tooltips: ${forecastSum} kWh`)
          } else {
            // Last resort: search entire page content for difference values
            console.log('No tooltips found, searching entire page content...')
            try {
              const pageContent = await page.content()
              // First try to find Difference values (net energy for battery)
              const differenceMatches = pageContent.match(/Difference[^0-9]*(\d+(?:\.\d+)?)\s*kWh/gi)
              if (differenceMatches) {
                console.log(`Found ${differenceMatches.length} Difference matches in page content:`, differenceMatches)
                for (const match of differenceMatches) {
                  const valueMatch = match.match(/(\d+(?:\.\d+)?)\s*kWh/i)
                  if (valueMatch) {
                    const value = parseFloat(valueMatch[1])
                    if (!isNaN(value) && value > 0 && value < 50) { // Reasonable range
                      pvGenerationValues.push(value)
                      console.log(`✅ Found page difference value: ${value} kWh`)
                    }
                  }
                }
              } else {
                // Fallback: Look for PV generation values
                const pvMatches = pageContent.match(/Estimated PV power generation[^0-9]*(\d+(?:\.\d+)?)\s*kWh/gi)
                if (pvMatches) {
                  console.log(`Found ${pvMatches.length} PV generation matches in page content:`, pvMatches)
                  for (const match of pvMatches) {
                    const valueMatch = match.match(/(\d+(?:\.\d+)?)\s*kWh/i)
                    if (valueMatch) {
                      const value = parseFloat(valueMatch[1])
                      if (!isNaN(value) && value > 0 && value < 50) { // Reasonable range
                        pvGenerationValues.push(value)
                        console.log(`⚠️ Found page PV generation (fallback): ${value} kWh`)
                      }
                    }
                  }
                }
              }
              
              if (pvGenerationValues.length > 0) {
                forecastSum = pvGenerationValues.reduce((sum, val) => sum + val, 0)
                forecastFound = true
                console.log(`Total forecast from page content: ${forecastSum} kWh`)
              } else {
                console.log('No difference or PV generation values found in page content')
                // Show some page content for debugging
                const contentSample = pageContent.substring(0, 2000)
                console.log('Page content sample:', contentSample)
              }
            } catch (e) {
              console.log('Page content search failed:', e.message)
            }
          }
        }
        
      } catch (error) {
        console.log('Tooltip extraction failed:', error.message)
      }
    }
    
    // Method 4: Try to execute JavaScript to get chart data (fallback)
    if (!forecastFound) {
      try {
        console.log('Attempting to extract chart data via JavaScript...')
        const chartData = await page.evaluate(() => {
          // Look for common chart libraries or data structures
          if (typeof window.chartData !== 'undefined') {
            return window.chartData
          }
          
          // Look for Highcharts
          if (typeof window.Highcharts !== 'undefined' && window.Highcharts.charts) {
            const charts = window.Highcharts.charts.filter(c => c)
            if (charts.length > 0) {
              return charts[0].series.map(s => s.data.map(d => d.y)).flat()
            }
          }
          
          // Look for D3 data
          if (typeof window.d3 !== 'undefined') {
            const svgs = document.querySelectorAll('svg')
            for (const svg of svgs) {
              if (svg.__data__) {
                return svg.__data__
              }
            }
          }
          
          // Look for any window variables containing "forecast" or "energy"
          const forecastVars = []
          for (const key in window) {
            if (key.toLowerCase().includes('forecast') || key.toLowerCase().includes('energy') || key.toLowerCase().includes('chart')) {
              try {
                const value = window[key]
                if (typeof value === 'object' && value !== null) {
                  forecastVars.push({key, value})
                }
              } catch (e) {
                // Skip problematic variables
              }
            }
          }
          
          return forecastVars.length > 0 ? forecastVars : null
        })
        
        if (chartData) {
          console.log('Found chart data via JavaScript:', JSON.stringify(chartData).substring(0, 200))
          // Try to extract numerical values
          const jsonString = JSON.stringify(chartData)
          const numbers = jsonString.match(/\d+(?:\.\d+)?/g) || []
          const validNumbers = numbers.map(n => parseFloat(n)).filter(n => n > 0 && n < 50)
          if (validNumbers.length > 0) {
            forecastSum = validNumbers.reduce((a, b) => a + b, 0) / validNumbers.length
            forecastFound = true
            console.log(`Extracted forecast from JavaScript data: ${forecastSum} kWh`)
          }
        }
      } catch (jsError) {
        console.log('Could not extract data via JavaScript:', jsError.message)
      }
    }
    
    if (!forecastFound) {
      console.log('No forecast data found, using fallback of 0 kWh')
      forecastSum = 0
    }
    
    console.log(`Calculated forecast sum: ${forecastSum} kWh`)
    
    return forecastSum
    
  } catch (error) {
    console.error('Error in getForecastData:', error.message)
    console.log('Returning 0 kWh as fallback')
    return 0
  }
}

exports.getCurrentStatusFromSunnyPortal = async function (page) {
  console.log('🔍 Getting current power values from Sunny Portal...')
  
  const result = {
    pvGeneration: null,
    consumption: null,
    purchasedElectricity: null,
    batteryCharging: null
  }
  
  try {
    // Navigate to current status page if not already there
    const currentUrl = page.url()
    if (!currentUrl.includes('HoManLive.aspx')) {
      console.log('Navigating to Current Status page...')
      await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx')
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      await page.waitForTimeout(5000)
    }
    
    console.log('Extracting current power values...')
    
    // Method 1: Target specific battery status elements based on actual HTML structure
    try {
      // PV power generation - look for div with PV power generation label
      const pvElement = page.locator('.batteryStatus-pv .batteryStatus-value')
      if (await pvElement.count() > 0) {
        const pvText = await pvElement.textContent()
        const pvMatch = pvText.match(/(\d+(?:\.\d+)?)/)
        if (pvMatch) {
          const value = parseFloat(pvMatch[1])
          // Check if kW unit is present in the parent element
          const unitElement = page.locator('.batteryStatus-pv .batteryStatus-unit')
          const unit = await unitElement.textContent()
          result.pvGeneration = unit.includes('kW') ? value * 1000 : value
          console.log(`✅ PV Generation: ${result.pvGeneration} W`)
        }
      }
      
      // Total consumption
      const consumptionElement = page.locator('.batteryStatus-consumption .batteryStatus-value')
      if (await consumptionElement.count() > 0) {
        const consumptionText = await consumptionElement.textContent()
        const consumptionMatch = consumptionText.match(/(\d+(?:\.\d+)?)/)
        if (consumptionMatch) {
          const value = parseFloat(consumptionMatch[1])
          const unitElement = page.locator('.batteryStatus-consumption .batteryStatus-unit')
          const unit = await unitElement.textContent()
          result.consumption = unit.includes('kW') ? value * 1000 : value
          console.log(`✅ Total Consumption: ${result.consumption} W`)
        }
      }
      
      // Purchased electricity (grid)
      const gridElement = page.locator('.batteryStatus-grid .batteryStatus-value')
      if (await gridElement.count() > 0) {
        const gridText = await gridElement.textContent()
        const gridMatch = gridText.match(/(\d+(?:\.\d+)?)/)
        if (gridMatch) {
          const value = parseFloat(gridMatch[1])
          const unitElement = page.locator('.batteryStatus-grid .batteryStatus-unit')
          const unit = await unitElement.textContent()
          result.purchasedElectricity = unit.includes('kW') ? value * 1000 : value
          console.log(`✅ Purchased Electricity: ${result.purchasedElectricity} W`)
        }
      }
      
      // Battery charging/discharging power
      const batteryElement = page.locator('.batteryStatus-battery .battery-power .batteryStatus-value')
      if (await batteryElement.count() > 0) {
        const batteryText = await batteryElement.textContent()
        const batteryMatch = batteryText.match(/(\d+(?:\.\d+)?)/)
        if (batteryMatch) {
          const value = parseFloat(batteryMatch[1])
          const unitElement = page.locator('.batteryStatus-battery .battery-power .batteryStatus-unit')
          const unit = await unitElement.textContent()
          const watts = unit.includes('kW') ? value * 1000 : value
          
          // Check if it's charging or discharging from the battery status
          const batteryStatus = await page.locator('.batteryStatus-battery').getAttribute('data-status')
          if (batteryStatus === 'charge') {
            result.batteryCharging = watts
            console.log(`✅ Battery Charging: ${result.batteryCharging} W`)
          } else {
            // It's discharging - represent as negative charging
            result.batteryCharging = -watts
            console.log(`✅ Battery Discharging: ${result.batteryCharging} W`)
          }
        }
      }
      
    } catch (e) {
      console.log('Error in structured data extraction:', e.message)
    }
    
    // Method 2: Fallback text-based extraction if structured extraction didn't work
    if (!result.pvGeneration && !result.consumption && !result.purchasedElectricity && !result.batteryCharging) {
      console.log('Structured extraction failed, trying text-based fallback...')
      const pageText = await page.textContent('body')
      const lines = pageText.split('\n')
      
      for (const line of lines) {
        const cleanLine = line.trim()
        
        // Look for PV generation patterns
        if (!result.pvGeneration && cleanLine.match(/PV.*generation.*(\d+(?:\.\d+)?)\s*(?:k?W)/i)) {
          const match = cleanLine.match(/(\d+(?:\.\d+)?)\s*(?:k?W)/i)
          if (match) {
            const value = parseFloat(match[1])
            result.pvGeneration = cleanLine.includes('kW') ? value * 1000 : value
            console.log(`✅ PV Generation (fallback): ${result.pvGeneration} W`)
          }
        }
        
        // Look for consumption patterns
        if (!result.consumption && cleanLine.match(/(?:total.*)?consumption.*(\d+(?:\.\d+)?)\s*(?:k?W)/i)) {
          const match = cleanLine.match(/(\d+(?:\.\d+)?)\s*(?:k?W)/i)
          if (match) {
            const value = parseFloat(match[1])
            result.consumption = cleanLine.includes('kW') ? value * 1000 : value
            console.log(`✅ Total Consumption (fallback): ${result.consumption} W`)
          }
        }
        
        // Look for purchased electricity patterns
        if (!result.purchasedElectricity && cleanLine.match(/(?:purchased|grid.*import|from.*grid).*(\d+(?:\.\d+)?)\s*(?:k?W)/i)) {
          const match = cleanLine.match(/(\d+(?:\.\d+)?)\s*(?:k?W)/i)
          if (match) {
            const value = parseFloat(match[1])
            result.purchasedElectricity = cleanLine.includes('kW') ? value * 1000 : value
            console.log(`✅ Purchased Electricity (fallback): ${result.purchasedElectricity} W`)
          }
        }
      }
    }
    
    // Calculate missing values if we have enough data
    if (!result.purchasedElectricity && result.consumption && result.pvGeneration) {
      result.purchasedElectricity = Math.max(0, result.consumption - result.pvGeneration)
      console.log(`✅ Purchased Electricity (calculated): ${result.purchasedElectricity} W`)
    }
    
    console.log('Sunny Portal current status extraction completed')
    console.log('Final result:', JSON.stringify(result, null, 2))
    return result
    
  } catch (error) {
    console.error('Error getting current status from Sunny Portal:', error.message)
    return result // Return partial results
  }
}

exports.getBatteryCapacityFromSunnyPortal = async function (page) {
  try {
    console.log('🔋 Getting battery capacity from Sunny Portal Dashboard...')
    
    // Navigate to Dashboard page
    await page.goto('https://www.sunnyportal.com/FixedPages/Dashboard.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    // Look for the plantInfo widget containing battery capacity
    const plantInfoWidget = page.locator('div.widgetBox[data-name="plantInfo"]')
    await plantInfoWidget.waitFor({ timeout: 30000 })
    
    // Look for the nominal battery capacity text
    const capacityText = await plantInfoWidget.locator('div:has-text("Nominal battery capacity:")').locator('+ div strong').textContent()
    
    if (capacityText) {
      // Parse the capacity - it's in format like "31,200 Wh" 
      const capacityMatch = capacityText.match(/([\d,]+)\s*Wh/i)
      if (capacityMatch) {
        // Convert Wh to kWh and remove commas
        const capacityWh = parseInt(capacityMatch[1].replace(/,/g, ''))
        const capacityKWh = capacityWh / 1000
        
        console.log(`✅ Found battery capacity: ${capacityText} = ${capacityKWh} kWh`)
        return capacityKWh
      }
    }
    
    console.log('❌ Could not find battery capacity in plantInfo widget')
    return null
    
  } catch (error) {
    console.error('Error getting battery capacity from Sunny Portal:', error.message)
    return null
  }
}

exports.getStateOfChargeFromSunnyPortal = async function (page) {
  try {
    console.log('🔋 Getting State of Charge from Sunny Portal Dashboard...')
    
    // Stay on Dashboard or navigate to it
    const currentUrl = page.url()
    if (!currentUrl.includes('Dashboard.aspx')) {
      await page.goto('https://www.sunnyportal.com/FixedPages/Dashboard.aspx')
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      await page.waitForTimeout(3000)
    }
    
    // Look for battery SOC information in various possible locations
    // Method 1: Look for battery percentage in any widget
    const socElements = page.locator(':has-text("%"):has-text("battery"), :has-text("Battery"):has-text("%")')
    const socCount = await socElements.count()
    
    for (let i = 0; i < socCount; i++) {
      try {
        const text = await socElements.nth(i).textContent()
        const socMatch = text.match(/(\d+(?:\.\d+)?)\s*%/)
        if (socMatch) {
          const soc = parseFloat(socMatch[1])
          if (soc >= 0 && soc <= 100) {
            console.log(`✅ Found SOC from dashboard: ${soc}%`)
            return soc
          }
        }
      } catch (e) {
        // Continue to next element
      }
    }
    
    // Method 2: Look for specific battery status widget
    try {
      const batteryWidget = page.locator('div.widgetBox:has-text("Battery")')
      if (await batteryWidget.count() > 0) {
        const batteryText = await batteryWidget.textContent()
        const socMatch = batteryText.match(/(\d+(?:\.\d+)?)\s*%/)
        if (socMatch) {
          const soc = parseFloat(socMatch[1])
          if (soc >= 0 && soc <= 100) {
            console.log(`✅ Found SOC from battery widget: ${soc}%`)
            return soc
          }
        }
      }
    } catch (e) {
      // Continue
    }
    
    console.log('⚠️ Could not find SOC on Dashboard - will try Current Status page')
    
    // Method 3: Fallback to Current Status page where we know SOC is available
    await page.goto('https://www.sunnyportal.com/FixedPages/HoManLive.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    // Look for SOC on the current status page
    const currentStatusElements = page.locator('text=/\\d+(?:\\.\\d+)?\\s*%/')
    const currentStatusCount = await currentStatusElements.count()
    
    for (let i = 0; i < currentStatusCount; i++) {
      try {
        const text = await currentStatusElements.nth(i).textContent()
        const socMatch = text.match(/(\d+(?:\.\d+)?)\s*%/)
        if (socMatch) {
          const soc = parseFloat(socMatch[1])
          // Look for values that make sense as SOC (0-100%)
          if (soc >= 0 && soc <= 100) {
            // Additional validation - check if it's near battery-related text
            const parentText = await currentStatusElements.nth(i).locator('..').textContent()
            if (parentText.toLowerCase().includes('battery') || 
                parentText.toLowerCase().includes('charge') || 
                parentText.toLowerCase().includes('storage')) {
              console.log(`✅ Found SOC from current status page: ${soc}%`)
              return soc
            }
          }
        }
      } catch (e) {
        // Continue to next element
      }
    }
    
    console.log('❌ Could not find SOC on either Dashboard or Current Status page')
    return null
    
  } catch (error) {
    console.error('Error getting SOC from Sunny Portal:', error.message)
    return null
  }
}

exports.checkForceChargingFromSunnyPortal = async function (page) {
  try {
    console.log('🔍 Checking force charging windows on Sunny Portal...')
    
    // Go to Plant Formula Configuration page
    await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)
    
    // Check for existing charging windows in multiple ways
    let windowCount = 0
    let activeWindows = []
    
    // Method 1: Look for remove buttons (existing logic)
    const removeButtons = page.locator('img[src="../Tools/images/buttons/remove_segment_btn.png"]')
    const removeButtonCount = await removeButtons.count()
    
    // Method 2: Look for charging time windows in the currentRatesList table
    const chargingRows = page.locator('#ctl00_ContentPlaceHolder1_BatteryChargeView_currentRatesList tbody tr')
    const tableRowCount = await chargingRows.count()
    
    // Method 3: Look for any table cell containing time patterns like "from XX:XX to XX:XX"
    const timeWindowCells = page.locator('td:has-text("from"), td:has-text("to")')
    const timeWindowCount = await timeWindowCells.count()
    
    // Method 4: Look for wattage values in charging windows (like "23000 Watt")
    const wattageRows = page.locator('td:has-text("Watt")')
    const wattageCount = await wattageRows.count()
    
    // Only count actual charging time windows, not just presence of text
    // Priority: 1) Remove buttons (most reliable), 2) Actual table rows with time patterns
    if (removeButtonCount > 0) {
      windowCount = removeButtonCount
    } else if (tableRowCount > 0) {
      // Verify table rows actually contain time patterns
      windowCount = 0
      for (let i = 0; i < tableRowCount; i++) {
        try {
          const rowText = await chargingRows.nth(i).textContent()
          if (rowText.match(/from (\d{2}):(\d{2}) to (\d{2}):(\d{2})/)) {
            windowCount++
          }
        } catch (e) {
          // Skip problematic rows
        }
      }
    } else {
      windowCount = 0
    }
    
    console.log(`🔍 Force charging detection results:`)
    console.log(`  - Remove buttons: ${removeButtonCount}`)
    console.log(`  - Table rows: ${tableRowCount}`)
    console.log(`  - Time window cells: ${timeWindowCount}`)
    console.log(`  - Wattage cells: ${wattageCount}`)
    console.log(`  - Final window count: ${windowCount}`)
    
    // Log detailed information about any found charging windows and check if they're currently active
    const now = new Date()
    const currentTime = now.getHours() * 60 + now.getMinutes() // Current time in minutes
    
    if (tableRowCount > 0) {
      for (let i = 0; i < tableRowCount; i++) {
        try {
          const rowText = await chargingRows.nth(i).textContent()
          console.log(`  - Charging window ${i + 1}: ${rowText.trim()}`)
          
          // Parse time windows to check if currently active (with 10-minute buffer)
          const timeMatch = rowText.match(/from (\d{2}):(\d{2}) to (\d{2}):(\d{2})/)
          if (timeMatch) {
            const startHour = parseInt(timeMatch[1])
            const startMin = parseInt(timeMatch[2])
            const endHour = parseInt(timeMatch[3])
            const endMin = parseInt(timeMatch[4])
            
            const startTime = startHour * 60 + startMin
            const endTime = endHour * 60 + endMin
            const endTimeWithBuffer = endTime + 10 // Add 10-minute buffer
            
            // Handle day boundary for end time
            const isActiveNow = (currentTime >= startTime && currentTime <= endTimeWithBuffer) ||
                              (endTime < startTime && (currentTime >= startTime || currentTime <= endTimeWithBuffer))
            
            activeWindows.push({
              start: `${timeMatch[1]}:${timeMatch[2]}`,
              end: `${timeMatch[3]}:${timeMatch[4]}`,
              endWithBuffer: `${String(Math.floor(endTimeWithBuffer / 60) % 24).padStart(2, '0')}:${String(endTimeWithBuffer % 60).padStart(2, '0')}`,
              isActive: isActiveNow,
              rawText: rowText.trim()
            })
            
            console.log(`    Active now (with 10min buffer): ${isActiveNow ? 'YES' : 'NO'} (${timeMatch[1]}:${timeMatch[2]} - ${timeMatch[3]}:${timeMatch[4]} + 10min buffer)`)
          }
        } catch (e) {
          console.log(`  - Could not read charging window ${i + 1}`)
        }
      }
    }
    
    // Check if any windows are currently active
    const hasActiveWindows = activeWindows.some(w => w.isActive)
    console.log(`🕐 Current time: ${String(Math.floor(currentTime / 60)).padStart(2, '0')}:${String(currentTime % 60).padStart(2, '0')}`)
    console.log(`⚡ Force charging currently active (with buffer): ${hasActiveWindows ? 'YES' : 'NO'}`)
    
    console.log('FORCE_CHARGE_WINDOWS_FOUND:', windowCount)
    console.log(`✅ Force charging check: ${windowCount} time windows found - Force charging is ${windowCount > 0 ? 'ON' : 'OFF'}`)
    
    return windowCount
    
  } catch (error) {
    console.error('Error checking force charge state:', error.message)
    console.log('FORCE_CHARGE_WINDOWS_FOUND: ERROR')
    throw error
  }
}