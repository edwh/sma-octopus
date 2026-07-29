require('dotenv').config()
const {test} = require('@playwright/test')

// Logs into ennexOS (2-step: ennexOS Login button -> SMA ID form) and SAVES the
// authenticated session to .ennexos-auth.json so other runs can reuse it and skip the
// flaky login. Re-run this whenever the saved session expires.
test('save ennexOS auth session', async ({page}) => {
  test.setTimeout(150000)
  await page.route('**/*', route => {
    const t = route.request().resourceType()
    return (t === 'image' || t === 'font' || t === 'media') ? route.abort() : route.continue()
  })

  await page.goto('https://ennexos.sunnyportal.com/login?next=%2Fdashboard%2Finitialize')
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)

  // Step 1: ennexOS start page -> click Login to hand off to SMA ID.
  await page.locator('[data-testid="button-primary"], button:has-text("Login")').first().click({ timeout: 20000 })
  console.log('clicked ennexOS Login')
  // Wait for the SMA ID credential form.
  await page.locator('input[name="username"]').waitFor({ state: 'visible', timeout: 30000 })
  console.log('SMA ID form visible at', page.url())

  // Step 2: credentials.
  await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
  await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
  await page.locator('button[type="submit"], button:has-text("Log in")').first().click()
  console.log('submitted credentials')

  // Wait until we're back on an authenticated ennexOS URL (plant id / dashboard).
  await page.waitForURL(/ennexos\.sunnyportal\.com\/(17318995|dashboard)/, { timeout: 40000 }).catch(() => {})
  await page.waitForTimeout(4000)
  const url = page.url()
  console.log('post-login url:', url)
  if (!/ennexos\.sunnyportal\.com/.test(url) || /\/login/.test(url)) {
    throw new Error('Login did not complete - still at ' + url)
  }

  await page.context().storageState({ path: '.ennexos-auth.json' })
  console.log('AUTH SAVED to .ennexos-auth.json')
})
