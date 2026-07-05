require('dotenv').config()
const {test} = require('@playwright/test')

// READ-ONLY diagnostic: logs in, reaches edit mode, then only inspects the DOM.
// It never clicks remove/save, so it cannot modify the Sunny Portal configuration.
test('Diagnose charge/tariff remove buttons', async ({page}) => {
  console.log('1. Logging in...')
  await page.goto('https://www.sunnyportal.com/')
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  if (page.url().includes('error=login_required')) {
    await page.goto('https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle')
  }
  try { await page.locator('button:has-text("Accept all")').click({ timeout: 3000 }) } catch (e) {}
  await page.locator('*[id$="SmaIdLoginButton"]').click()
  await page.waitForTimeout(3000)
  await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
  await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
  await page.locator('button:has-text("Log in")').click()
  try { await page.waitForNavigation({ timeout: 30000 }) } catch (e) { await page.waitForTimeout(5000) }
  console.log('✅ Logged in')

  console.log('2. Going to Plant Formula Configuration...')
  await page.goto('https://www.sunnyportal.com/Templates/PlantFormulaConfiguration.aspx')
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Reject cookies (best effort)
  try {
    const reject = page.locator('a.cmpboxbtn.cmpboxbtnno.cmptxt_btn_no, button:has-text("Reject all")').first()
    if (await reject.count() > 0) { await reject.click({ timeout: 5000 }); await page.waitForTimeout(2000) }
    await page.evaluate(() => { const w = document.querySelector('#cmpwrapper'); if (w) w.remove() })
  } catch (e) {}

  console.log('3. Entering edit mode...')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2000)
  const editButton = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
  try { await editButton.click({ timeout: 10000 }) } catch (e) { await editButton.click({ force: true }) }
  await page.waitForTimeout(8000)
  console.log('✅ Edit mode active')

  // Inspect every remove-segment button and report its id + which table it belongs to.
  const info = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img[src*="remove_segment_btn"]'))
    return imgs.map(img => {
      // Walk up to find the nearest ancestor table/div with an id (identifies the section).
      let el = img, container = null
      while (el && el !== document.body) {
        if (el.id && (el.id.includes('Table') || el.id.includes('table') || el.id.includes('View'))) { container = el.id; break }
        el = el.parentElement
      }
      const rect = img.getBoundingClientRect()
      return {
        id: img.id || '(no id)',
        container: container || '(none)',
        visible: rect.width > 0 && rect.height > 0,
      }
    })
  })

  console.log(`DIAG_REMOVE_BUTTON_COUNT: ${info.length}`)
  info.forEach((b, i) => {
    console.log(`DIAG_REMOVE_BUTTON ${i}: id="${b.id}" container="${b.container}" visible=${b.visible}`)
  })

  // Report battery-charge-table structure for context.
  const batTables = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[id^="batChargeTable"], #addBatChargeButton'))
    return els.slice(0, 20).map(e => ({ id: e.id, tag: e.tagName.toLowerCase() }))
  })
  console.log(`DIAG_BAT_ELEMENTS: ${JSON.stringify(batTables)}`)

  await page.screenshot({ path: 'diagnose-edit-mode.png', fullPage: true })
  console.log('=== DIAGNOSTIC COMPLETE (no changes made) ===')
})
