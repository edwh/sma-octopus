require('dotenv').config()
const {test} = require('@playwright/test')

// READ-ONLY exploration of the NEW ennexOS Sunny Portal UI. Logs in, opens the battery
// configuration page the user pointed at, screenshots it, and dumps the interactive
// controls (buttons, inputs, switches, selects, testids) so we can build ON/OFF scripts.
// Makes NO changes.
test('Explore ennexOS battery config', async ({page}) => {
  test.setTimeout(240000)
  const BATTERY_URL = 'https://ennexos.sunnyportal.com/17318995/configuration/view-autonomous-energy-management-configuration/battery-edit'

  console.log('1. Going to ennexOS login...')
  await page.goto('https://ennexos.sunnyportal.com/login?next=%2Fdashboard%2Finitialize')
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
  try { await page.locator('button:has-text("Accept all"), button:has-text("Accept")').first().click({ timeout: 4000 }); console.log('accepted cookies') } catch (e) {}

  console.log(`   URL after login page: ${page.url()}`)
  // ennexOS start page has no credential fields - click its Login button to hand off to
  // the SMA ID auth form (login.sma.energy), THEN fill credentials there.
  try {
    await page.locator('[data-testid="button-primary"], button:has-text("Login")').first().click({ timeout: 15000 })
    console.log('   clicked ennexOS Login -> redirecting to SMA ID')
    await page.waitForTimeout(6000)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    console.log(`   URL at SMA ID: ${page.url()}`)
    try { await page.locator('button:has-text("Accept all"), button:has-text("Accept")').first().click({ timeout: 4000 }) } catch (e) {}
    await page.locator('input[name="username"]').waitFor({ timeout: 20000 })
    await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
    await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
    console.log('   filled credentials')
    await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Login")').first().click()
  } catch (e) {
    console.log('   login flow issue:', e.message)
  }
  await page.waitForTimeout(10000)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  console.log(`2. Logged in, URL now: ${page.url()}`)
  await page.screenshot({ path: 'ennexos-after-login.png', fullPage: true }).catch(() => {})

  console.log('3. Navigating to battery-edit config...')
  await page.goto(BATTERY_URL)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(8000)
  console.log(`   URL now: ${page.url()}`)
  await page.screenshot({ path: 'ennexos-battery-edit.png', fullPage: true }).catch(() => {})

  // Dump interactive controls.
  const dump = await page.evaluate(() => {
    const txt = el => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    const attrs = el => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      testid: el.getAttribute('data-testid') || '',
      aria: el.getAttribute('aria-label') || '',
      role: el.getAttribute('role') || '',
      placeholder: el.getAttribute('placeholder') || '',
      value: el.value !== undefined ? String(el.value).slice(0, 40) : '',
      text: txt(el),
    })
    const pick = sel => Array.from(document.querySelectorAll(sel)).slice(0, 60).map(attrs)
    return {
      buttons: pick('button, [role="button"]'),
      inputs: pick('input, textarea, select'),
      switches: pick('[role="switch"], [type="checkbox"]'),
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,label,legend')).slice(0, 40).map(e => txt(e)).filter(Boolean),
      testids: Array.from(document.querySelectorAll('[data-testid]')).slice(0, 60).map(e => e.getAttribute('data-testid')),
    }
  }).catch(e => ({ error: e.message }))

  console.log('=== BATTERY-EDIT PAGE DUMP ===')
  console.log(JSON.stringify(dump, null, 1))
  console.log('=== EXPLORE COMPLETE (no changes) ===')
})
