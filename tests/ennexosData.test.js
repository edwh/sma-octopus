require('dotenv').config()
const {test} = require('@playwright/test')
const {gotoAuthed} = require('./ennexosSession')

// ennexOS data scrape (replaces the dead getForecastData.test.js). Reads live values from
// the dashboard, plus the force-charge window state from the battery-edit config, and
// prints machine-readable marker lines for sma.js to parse. READ-ONLY (never Saves).
test.use({ storageState: '.ennexos-auth.json' })

const num = s => { const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null }

test('ennexOS data scrape', async ({page}) => {
  test.setTimeout(150000)
  await page.route('**/*', route => {
    const t = route.request().resourceType()
    return (t === 'image' || t === 'font' || t === 'media') ? route.abort() : route.continue()
  })

  // ---- dashboard: SOC, capacity, PV, consumption, battery power ----
  await gotoAuthed(page, 'https://ennexos.sunnyportal.com/17318995/dashboard', 9000)
  try { await page.locator('.cmpboxbtnyes, button:has-text("Accept all")').first().click({ timeout: 4000 }) } catch (e) {}
  await page.evaluate(() => document.querySelectorAll('#cmpwrapper,#cmpbox,[class*="cmpbox"],[id*="cmp"]').forEach(e => e.remove())).catch(() => {})
  await page.waitForTimeout(3000)

  const dash = await page.evaluate(() => {
    const txt = sel => { const el = document.querySelector(sel); return el ? (el.innerText || '').trim().replace(/\s+/g, ' ') : '' }
    // Energy-flow 4-tuple "PV grid battery home" (order: PV, grid, battery, home).
    const flowEl = document.querySelector('.hasBattery')
    const flow = flowEl ? (flowEl.innerText || '').trim().replace(/\s+/g, ' ') : ''
    return {
      soc: txt('[data-testid="sma-widget-battery-state-of-charge"]'),
      capacity: txt('[data-testid="component-info-BATTERYCAPACITY"]'),
      battery: txt('[data-testid="widget-Battery"]'),
      pv: txt('[data-testid="actual-power-value-label"]'),
      flow,
    }
  }).catch(e => ({ error: e.message }))

  const soc = num(dash.soc)
  const capacity = num(dash.capacity)
  const pvGeneration = num(dash.pv)
  // battery widget text e.g. "Battery 9 % Battery state of charge 22 W Discharging power"
  let batteryPower = null
  const bm = String(dash.battery).match(/([\d,]+)\s*W\s*(Charging|Discharging)/i)
  if (bm) batteryPower = num(bm[1]) * (/Discharging/i.test(bm[2]) ? -1 : 1)
  // consumption = last value of the "PV grid battery home" flow tuple
  const flowNums = String(dash.flow).match(/-?[\d,]+(?:\.\d+)?\s*W/g) || []
  const consumption = flowNums.length >= 4 ? num(flowNums[flowNums.length - 1]) : null

  // ---- battery-edit: force-charge toggle + window rows ----
  await gotoAuthed(page, 'https://ennexos.sunnyportal.com/17318995/configuration/view-autonomous-energy-management-configuration/battery-edit', 5000)
  await page.evaluate(() => document.querySelectorAll('#cmpwrapper,#cmpbox,[class*="cmpbox"],[id*="cmp"]').forEach(e => e.remove())).catch(() => {})
  await page.waitForTimeout(1500)

  const cfg = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="timeframe-based-battery-charging-toggle"]')
    const sw = t && t.querySelector('[role="switch"]')
    const rows = Array.from(document.querySelectorAll('ennexos-accordion-row')).map(r =>
      (r.querySelector('[data-testid="timeframe-config"]')?.innerText || r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60))
    return { toggle: sw ? sw.getAttribute('aria-checked') === 'true' : null, rows }
  }).catch(e => ({ error: e.message }))

  // Does any row's window cover the current plant-local (Europe/London) time?
  const nowHM = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, hour: '2-digit', minute: '2-digit' })
  const nowMin = parseInt(nowHM.slice(0, 2)) * 60 + parseInt(nowHM.slice(3, 5))
  const windowActive = (cfg.rows || []).some(txt => {
    const m = txt.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/)
    if (!m) return false
    const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4]
    return s <= e ? (nowMin >= s && nowMin < e) : (nowMin >= s || nowMin < e) // handle midnight wrap
  })
  const forceChargeActive = cfg.toggle === true && windowActive

  // ---- emit markers ----
  console.log(`SOC_FROM_ENNEXOS: ${soc}`)
  console.log(`CAPACITY_FROM_ENNEXOS: ${capacity}`)
  console.log(`PV_GENERATION_W: ${pvGeneration}`)
  console.log(`CONSUMPTION_W: ${consumption}`)
  console.log(`BATTERY_POWER_W: ${batteryPower}`)
  console.log(`FORCE_CHARGE_TOGGLE: ${cfg.toggle}`)
  console.log(`FORCE_CHARGE_WINDOWS_FOUND: ${(cfg.rows || []).length}`)
  console.log(`FORCE_CHARGE_WINDOW_ACTIVE: ${windowActive}`)
  console.log(`FORCE_CHARGE_ACTIVE: ${forceChargeActive}`)
  console.log(`ENNEXOS_ROWS: ${JSON.stringify(cfg.rows)}`)
  console.log(`ENNEXOS_PLANT_TIME: ${nowHM}`)
})
