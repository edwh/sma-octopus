require('dotenv').config()
const {test} = require('@playwright/test')

// READ-ONLY deeper exploration of the ennexOS time-controlled battery charging form.
// Dismisses the cookie dialog, then reveals the add-time-period form and the existing
// row's controls so we can build ON/OFF. NEVER clicks Save, so nothing persists.
test('Explore ennexOS timeframe charging form', async ({page}) => {
  test.setTimeout(240000)
  const BATTERY_URL = 'https://ennexos.sunnyportal.com/17318995/configuration/view-autonomous-energy-management-configuration/battery-edit'

  // --- login (proven flow) ---
  await page.goto('https://ennexos.sunnyportal.com/login?next=%2Fdashboard%2Finitialize')
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.locator('[data-testid="button-primary"], button:has-text("Login")').first().click({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(6000)
  await page.locator('input[name="username"]').waitFor({ timeout: 20000 })
  await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
  await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
  await page.locator('button[type="submit"], button:has-text("Log in")').first().click()
  await page.waitForTimeout(9000)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  console.log('logged in:', page.url())

  await page.goto(BATTERY_URL)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(6000)

  // --- dismiss consentmanager (cmpbox) cookie consent ---
  try {
    await page.locator('.cmpboxbtnyes, a.cmpboxbtn.cmpboxbtnyes, button:has-text("Accept all")').first().click({ timeout: 6000 })
    console.log('clicked accept-all')
  } catch (e) { console.log('accept click failed:', e.message) }
  await page.waitForTimeout(1500)
  await page.evaluate(() => { document.querySelectorAll('#cmpwrapper, #cmpbox, [class*="cmpbox"], [class*="cmpContainer"], [id*="cmp"]').forEach(e => e.remove()) })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'ennexos-battery-clean.png', fullPage: false }).catch(() => {})

  const dumpControls = async (tag) => {
    const d = await page.evaluate(() => {
      const info = el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', id: el.id || '', testid: el.getAttribute('data-testid') || '', aria: el.getAttribute('aria-label') || '', role: el.getAttribute('role') || '', placeholder: el.getAttribute('placeholder') || '', value: el.value !== undefined ? String(el.value).slice(0, 30) : '', text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50) })
      const form = document.querySelector('[data-testid="battery-edit-form"]') || document.body
      return {
        inputs: Array.from(form.querySelectorAll('input, textarea, select, mat-select, [role="combobox"]')).map(info),
        switches: Array.from(form.querySelectorAll('[role="switch"]')).map(e => ({ id: e.id, testid: e.getAttribute('data-testid') || '', checked: e.getAttribute('aria-checked') })),
        buttons: Array.from(form.querySelectorAll('button, [role="button"]')).map(info).filter(b => b.text || b.testid || b.aria),
        rows: Array.from(form.querySelectorAll('[data-testid*="accordion-row"], [data-testid*="timeframe"]')).map(e => ({ testid: e.getAttribute('data-testid'), text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60) })),
      }
    })
    console.log(`=== CONTROLS (${tag}) ===`)
    console.log(JSON.stringify(d, null, 1))
  }

  await dumpControls('before add')

  // Reveal the add-time-period form (client-side only; never saved).
  try {
    const add = page.locator('[data-testid="add-accordion-row"], button:has-text("Adding a time period")').first()
    await add.scrollIntoViewIfNeeded().catch(() => {})
    await add.click({ timeout: 8000 })
    console.log('clicked add-accordion-row')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'ennexos-add-period.png', fullPage: false }).catch(() => {})
    await dumpControls('after add-row')
  } catch (e) {
    console.log('could not open add form:', e.message)
  }

  console.log('=== EXPLORE2 COMPLETE (no changes saved) ===')
})
