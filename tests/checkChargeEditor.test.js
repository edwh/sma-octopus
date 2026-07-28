require('dotenv').config()
const {test} = require('@playwright/test')

// READ-ONLY standby detector. Logs in, opens the battery-charge config, clicks Edit,
// and reports whether the charge editor (addBatChargeButton) becomes reachable. When the
// inverter is in standby (e.g. after a power cut) Sunny Portal will not enter the
// battery-charge editor, so the button never appears. It NEVER saves or removes anything,
// so it cannot change the plant configuration.
//
// Emits exactly one machine-readable line for standby-monitor.js to parse:
//   CHARGE_EDITOR_REACHABLE: true   -> normal
//   CHARGE_EDITOR_REACHABLE: false  -> editor did not open (inverter likely in standby)
test('Check battery charge editor reachable', async ({page}) => {
  let reachable = false
  try {
    console.log('1. Logging in...')
    await page.goto('https://www.sunnyportal.com/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })
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

    // Dismiss cookie overlay (best effort) so it cannot intercept the Edit click.
    try {
      const reject = page.locator('a.cmpboxbtn.cmpboxbtnno.cmptxt_btn_no, button:has-text("Reject all")').first()
      if (await reject.count() > 0) { await reject.click({ timeout: 5000 }); await page.waitForTimeout(2000) }
      await page.evaluate(() => { const w = document.querySelector('#cmpwrapper'); if (w) w.remove() })
    } catch (e) {}

    console.log('3. Clicking Edit...')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)
    const editButton = page.locator('#ctl00_ContentPlaceHolder1_EditConfigurationButton')
    if (await editButton.count() === 0) {
      console.log('⚠️  Edit button not present on config page')
    } else {
      try { await editButton.click({ timeout: 10000 }) } catch (e) { await editButton.click({ force: true }).catch(() => {}) }
    }

    // Wait (generously) for the charge editor to attach. If the inverter is in standby it
    // never will, and we fall through to reachable=false.
    console.log('4. Waiting up to 30s for addBatChargeButton...')
    try {
      await page.locator('#addBatChargeButton').waitFor({ state: 'attached', timeout: 30000 })
      reachable = (await page.locator('#addBatChargeButton').count()) > 0
    } catch (e) {
      reachable = false
    }

    await page.screenshot({ path: 'standby-check.png', fullPage: false, timeout: 20000 }).catch(() => {})
  } catch (e) {
    // Any unexpected error leaves reachable=false but we flag it as inconclusive so the
    // monitor can distinguish "editor absent" from "probe crashed / network issue".
    console.log(`CHARGE_EDITOR_ERROR: ${e.message}`)
  }

  console.log(`CHARGE_EDITOR_REACHABLE: ${reachable}`)
})
