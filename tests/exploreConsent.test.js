require('dotenv').config()
const {test} = require('@playwright/test')

// READ-ONLY: identify the cookie-consent dialog so we can dismiss it in the real scripts.
test('Probe ennexOS cookie consent', async ({page}) => {
  test.setTimeout(240000)
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
  await page.goto('https://ennexos.sunnyportal.com/17318995/configuration/view-autonomous-energy-management-configuration/battery-edit')
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(6000)

  console.log('=== FRAMES ===')
  for (const f of page.frames()) console.log(`frame url=${f.url()} name=${f.name()}`)

  console.log('=== page-level Accept/Reject buttons ===')
  for (const label of ['Accept all', 'Reject all', 'Accept', 'Settings']) {
    const loc = page.locator(`button:has-text("${label}"), a:has-text("${label}")`)
    console.log(`  "${label}": count=${await loc.count()}`)
  }

  console.log('=== per-frame Accept/Reject buttons ===')
  for (const f of page.frames()) {
    for (const label of ['Accept all', 'Reject all']) {
      try {
        const c = await f.locator(`button:has-text("${label}"), a:has-text("${label}")`).count()
        if (c > 0) console.log(`  frame ${f.url().slice(0, 60)} -> "${label}" count=${c}`)
      } catch (e) {}
    }
  }

  console.log('=== consent-container candidates (top document) ===')
  const containers = await page.evaluate(() => {
    const out = []
    const wanted = /consent|cookie|cmp|usercentrics|privacy/i
    document.querySelectorAll('div,section,aside,dialog').forEach(el => {
      const id = el.id || '', cls = (typeof el.className === 'string' ? el.className : '') || ''
      if ((wanted.test(id) || wanted.test(cls)) && el.offsetHeight > 100) {
        out.push({ id, cls: cls.slice(0, 80), tag: el.tagName.toLowerCase(), h: el.offsetHeight })
      }
    })
    return out.slice(0, 15)
  })
  console.log(JSON.stringify(containers, null, 1))

  console.log('=== try dismissal strategies ===')
  // A: page-level click
  let dismissed = false
  for (const label of ['Accept all', 'Reject all']) {
    try {
      const b = page.locator(`button:has-text("${label}")`).first()
      if (await b.isVisible({ timeout: 1000 })) { await b.click(); console.log(`A: clicked page "${label}"`); dismissed = true; break }
    } catch (e) {}
  }
  // B: iframe click
  if (!dismissed) {
    for (const f of page.frames()) {
      for (const label of ['Accept all', 'Reject all']) {
        try {
          const b = f.locator(`button:has-text("${label}")`).first()
          if (await b.count() > 0) { await b.click({ timeout: 3000 }); console.log(`B: clicked iframe "${label}"`); dismissed = true; break }
        } catch (e) {}
      }
      if (dismissed) break
    }
  }
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'ennexos-consent-after.png', fullPage: true }).catch(() => {})
  console.log(`dismissed=${dismissed}`)
  console.log('=== CONSENT PROBE COMPLETE ===')
})
