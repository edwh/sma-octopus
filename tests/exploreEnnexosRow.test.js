require('dotenv').config()
const {test} = require('@playwright/test')

// READ-ONLY: add a new time-period row and dump its edit form (start/end/power) plus any
// delete/remove controls in the section, so we can build ON and OFF. No Save.
test('Dump ennexOS add-row form + delete controls', async ({page}) => {
  test.setTimeout(180000)
  await page.route('**/*', route => {
    const t = route.request().resourceType()
    return (t === 'image' || t === 'font' || t === 'media') ? route.abort() : route.continue()
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
  try { await page.locator('.cmpboxbtnyes, button:has-text("Accept all")').first().click({ timeout: 5000 }) } catch (e) {}
  await page.evaluate(() => document.querySelectorAll('#cmpwrapper,#cmpbox,[class*="cmpbox"],[id*="cmp"]').forEach(e => e.remove())).catch(() => {})
  await page.waitForTimeout(1500)

  try {
    await page.locator('[data-testid="add-accordion-row"]').first().click({ timeout: 8000 })
    console.log('clicked add-accordion-row')
  } catch (e) { console.log('add failed:', e.message) }
  await page.waitForTimeout(3000)

  const controls = await page.evaluate(() => {
    const info = el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', id: el.id || '', testid: el.getAttribute('data-testid') || '', aria: el.getAttribute('aria-label') || '', role: el.getAttribute('role') || '', placeholder: el.getAttribute('placeholder') || '', value: el.value !== undefined ? String(el.value).slice(0, 30) : '', text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), icon: el.querySelector ? (el.querySelector('[data-icon]')?.getAttribute('data-icon') || '') : '' })
    const body = document.querySelector('.mat-expansion-panel.mat-expanded .mat-expansion-panel-body')
    const section = document.querySelector('[data-testid="battery-charge-timeframes"]') || document.body
    return {
      formInputs: body ? Array.from(body.querySelectorAll('input, textarea, select, mat-select, [role="combobox"], [role="spinbutton"], [contenteditable]')).map(info) : 'NO EXPANDED BODY',
      formTestids: body ? Array.from(body.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid')) : [],
      formHtml: body ? body.outerHTML.replace(/>\s+</g, '><').slice(0, 5000) : '',
      deleteish: Array.from(section.querySelectorAll('[data-testid*="delete"],[data-testid*="remove"],[aria-label*="elete"],[aria-label*="emove"],[data-icon*="delete"],[data-icon*="trash"]')).map(info),
      sectionButtons: Array.from(section.querySelectorAll('button')).map(info).filter(b => b.icon || b.aria || (b.text && b.text.length < 30)),
    }
  }).catch(e => ({ error: e.message }))
  console.log('===== ADD-ROW FORM + DELETE =====')
  console.log(JSON.stringify(controls, null, 1))
  console.log('=== COMPLETE ===')
})
