// Shared ennexOS session helper: self-healing auth. Scripts reuse the saved
// .ennexos-auth.json session (fast path); if that session has expired, gotoAuthed() detects
// the login redirect, performs the 2-step ennexOS -> SMA ID login inline, re-saves the
// session, and continues - so a stale session never fails a run.
const AUTH_FILE = '.ennexos-auth.json'
const LOGIN_URL = 'https://ennexos.sunnyportal.com/login?next=%2Fdashboard%2Finitialize'

// Are we looking at a login / SMA-ID page rather than the authenticated app?
async function isLoggedOut(page) {
  const url = page.url()
  if (/login\.sma\.energy/.test(url) || /\/login(\?|$|\/)/.test(url) || /\/authorize/.test(url)) return true
  if (await page.locator('input[name="username"]').count() > 0) return true
  const hasApp = await page.locator('[data-testid="header"], [data-testid="battery-edit-form"], [data-testid="widget-Battery"], [data-testid="battery-charge-timeframes"]').count() > 0
  const hasLoginBtn = await page.locator('[data-testid="button-primary"]:has-text("Login"), [data-testid="input-login"], button:has-text("Login")').count() > 0
  return hasLoginBtn && !hasApp
}

// Perform the 2-step login (ennexOS Login button -> SMA ID credentials) and save the session.
async function doLogin(page) {
  // If the SMA ID credential form isn't showing yet, click the ennexOS "Login" hand-off.
  if (await page.locator('input[name="username"]').count() === 0) {
    await page.locator('[data-testid="button-primary"], button:has-text("Login")').first().click({ timeout: 20000 }).catch(() => {})
    await page.locator('input[name="username"]').waitFor({ state: 'visible', timeout: 30000 })
  }
  await page.locator('input[name="username"]').fill(process.env.SUNNY_PORTAL_USERNAME)
  await page.locator('input[name="password"]').fill(process.env.SUNNY_PORTAL_PASSWORD)
  await page.locator('button[type="submit"], button:has-text("Log in")').first().click()
  await page.waitForURL(/ennexos\.sunnyportal\.com\/(17318995|dashboard)/, { timeout: 40000 }).catch(() => {})
  await page.waitForTimeout(3000)
  if (/\/login/.test(page.url()) || await page.locator('input[name="username"]').count() > 0) {
    throw new Error('ennexOS login did not complete - still at ' + page.url())
  }
  await page.context().storageState({ path: AUTH_FILE })
  console.log('re-authenticated ennexOS session (saved ' + AUTH_FILE + ')')
}

// Navigate to url with the saved session; if the session is invalid, log in and retry once.
async function gotoAuthed(page, url, settleMs = 3000) {
  await page.goto(url)
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(settleMs)
  if (await isLoggedOut(page)) {
    console.log('ennexOS session invalid - logging in')
    if (await page.locator('input[name="username"]').count() === 0 && !/login/.test(page.url())) {
      await page.goto(LOGIN_URL)
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(2000)
    }
    await doLogin(page)
    await page.goto(url)
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(settleMs)
    if (await isLoggedOut(page)) throw new Error('still logged out after re-auth at ' + url)
  }
}

module.exports = { gotoAuthed, isLoggedOut, doLogin, AUTH_FILE }
