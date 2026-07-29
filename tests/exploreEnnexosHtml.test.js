require('dotenv').config()
const {test} = require('@playwright/test')

// READ-ONLY, memory-light exploration: blocks images/fonts/media (the ennexOS SPA OOMs
// Chromium on the Pi otherwise), logs in, opens battery-edit, dismisses consent, and dumps
// the time-controlled charging section's HTML before/after opening the add-period form so
// we get exact selectors for start/end/power fields and the row delete control. No Save.
test('Dump ennexOS timeframe HTML', async ({page}) => {
  test.setTimeout(180000)

  // Cut memory: drop images, fonts, media.
  await page.route('**/*', route => {
    const t = route.request().resourceType()
    if (t === 'image' || t === 'font' || t === 'media') return route.abort()
    return route.continue()
  })

  await page.goto('https://ennexos.sunnyportal.com/login?next=%2Fdashboard%2Finitialize')
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.locator('[data-testid="button-primary"], button:has-text("Login")').first().click({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(5000)
  await page.locator('input[name="username"]').waitFor({ timeout: 20000 })
  await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
  await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
  await page.locator('button[type="submit"], button:has-text("Log in")').first().click()
  await page.waitForTimeout(7000)
  console.log('logged in:', page.url())

  await page.goto('https://ennexos.sunnyportal.com/17318995/configuration/view-autonomous-energy-management-configuration/battery-edit')
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(5000)

  // dismiss consentmanager
  try { await page.locator('.cmpboxbtnyes, a.cmpboxbtn.cmpboxbtnyes, button:has-text("Accept all")').first().click({ timeout: 5000 }) } catch (e) {}
  await page.evaluate(() => document.querySelectorAll('#cmpwrapper,#cmpbox,[class*="cmpbox"],[id*="cmp"]').forEach(e => e.remove())).catch(() => {})
  await page.waitForTimeout(1500)

  const dumpHtml = async (tag) => {
    const html = await page.evaluate(() => {
      const sec = document.querySelector('[data-testid="battery-charge-timeframes"]')
        || document.querySelector('[data-testid="timeframe-based-battery-charging-active-details"]')
        || document.querySelector('[data-testid="battery-edit-form"]')
      if (!sec) return '(section not found)'
      // Strip noise: remove long class lists' values kept, but trim whitespace.
      return sec.outerHTML.replace(/>\s+</g, '><').slice(0, 9000)
    }).catch(e => `(err ${e.message})`)
    console.log(`\n===== HTML (${tag}) =====\n${html}\n===== END (${tag}) =====`)
  }

  await dumpHtml('before-add')

  try {
    const add = page.locator('[data-testid="add-accordion-row"], button:has-text("Adding a time period")').first()
    await add.scrollIntoViewIfNeeded().catch(() => {})
    await add.click({ timeout: 8000 })
    await page.waitForTimeout(3000)
    console.log('clicked add-accordion-row')
    await dumpHtml('after-add')
  } catch (e) {
    console.log('add click failed:', e.message)
  }

  console.log('=== HTML DUMP COMPLETE ===')
})
