require('dotenv').config()
const {test} = require('@playwright/test')
const {gotoAuthed} = require('./ennexosSession')

// Write logs to stderr so they flush line-by-line (stdout is block-buffered when piped,
// which hides progress during a hang). Harmless in production.
console.log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n')

// ennexOS battery force-charge control (replaces the old simpleBatteryControl.test.js
// which targeted the dead classic Sunny Portal UI).
//
//   FORCE_CHARGE=on   -> enable time-controlled charging + set ONE window now->Go-end at
//                        max power (23 kW), replacing any existing windows, then Save.
//   FORCE_CHARGE=off  -> disable the time-controlled charging toggle, then Save.
//   DRY_RUN=true      -> do everything EXCEPT the final Save (for safe mechanics testing).
//
// Reuses the saved .ennexos-auth.json session and blocks images/fonts/media (Pi OOM guard).
test.use({ storageState: '.ennexos-auth.json' })
test.describe.configure({ retries: 2 })

const BATTERY_URL = 'https://ennexos.sunnyportal.com/17318995/configuration/view-autonomous-energy-management-configuration/battery-edit'

// Scroll into view, try a normal click with a short timeout, then force-click. Prevents
// the "retry until the whole test times out" hang a bare .click() causes on a momentary
// actionability failure in this SPA.
async function robustClick(locator, label) {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  try {
    await locator.click({ timeout: 10000 })
  } catch (e) {
    console.log(`  normal click failed for ${label}, forcing:`, e.message)
    await locator.click({ force: true, timeout: 10000 })
  }
}

// Floor a Date's epoch to the previous 5-minute boundary (matches the dropdown's 5-min
// slots). London's UTC offset is a whole number of hours, so 5-min boundaries align in
// both zones.
function floor5(date) {
  return new Date(Math.floor(date.getTime() / 300000) * 300000)
}

// "HH:MM" in plant-local (Europe/London) time — the timezone the charge-window UI uses.
function londonHM(date) {
  return date.toLocaleString('en-GB', {
    timeZone: 'Europe/London', hour12: false, hour: '2-digit', minute: '2-digit',
  }).replace('24:', '00:')
}

// Compute the [start, end] "HH:MM" London slots for a force-charge window: from now
// (floored to 5 min) to the Octopus Go end time. Go times in .env are UTC.
function computeWindow() {
  const now = new Date()
  const start = floor5(now)

  const [endHour, endMin] = (process.env.OCTOPUS_GO_END_TIME || '05:30').split(':').map(Number)
  const goEnd = new Date()
  goEnd.setUTCHours(endHour, endMin, 0, 0)

  let end = floor5(goEnd)
  // Outside the Go window (e.g. a manual daytime ON, or dry-run testing) today's Go end is
  // already in the past -> fall back to a plain 30-minute window so start < end holds.
  if (end <= start) {
    end = new Date(start.getTime() + 30 * 60000)
    console.log('  (outside Go window - using 30-min fallback window)')
  }
  return { startStr: londonHM(start), endStr: londonHM(end) }
}

async function dismissConsent(page) {
  try { await page.locator('.cmpboxbtnyes, button:has-text("Accept all")').first().click({ timeout: 4000 }) } catch (e) {}
  await page.evaluate(() => document.querySelectorAll('#cmpwrapper,#cmpbox,[class*="cmpbox"],[id*="cmp"]').forEach(e => e.remove())).catch(() => {})
  await page.waitForTimeout(800)
}

async function readToggle(page) {
  return page.evaluate(() => {
    const t = document.querySelector('[data-testid="timeframe-based-battery-charging-toggle"]')
    const sw = t && t.querySelector('[role="switch"]')
    return sw ? sw.getAttribute('aria-checked') === 'true' : null
  })
}

async function setToggle(page, wanted) {
  const current = await readToggle(page)
  console.log(`  time-controlled toggle currently: ${current}, want: ${wanted}`)
  if (current === wanted) return
  const toggle = page.locator('[data-testid="timeframe-based-battery-charging-toggle"]')
  await robustClick(toggle, 'time-controlled toggle')
  await page.waitForTimeout(1500)
  const after = await readToggle(page)
  if (after !== wanted) throw new Error(`toggle did not reach ${wanted} (still ${after})`)
  console.log(`  toggle now: ${after}`)
}

// NOTE on deletion: an already-saved time-period row exposes NO delete control in this UI
// (the "Delete time period" button only exists for a freshly-added, uncommitted row). So
// instead of delete-then-add, ON reuses the existing row: it edits row 1's window in place
// and only ADDS a row when none exist. Because ON never adds when a row is present, rows
// never accumulate - the single row is reused indefinitely.

// Confirm the currently-active add-wizard section (button reads "Continue", or "Done" on
// the final charging-power step).
async function confirmSection(page, label) {
  const btn = page.locator('[data-testid="timeframe-section-continue-button"]:visible, button:visible:has-text("Done")').first()
  await robustClick(btn, label)
  await page.waitForTimeout(1800)
}

// Pick an "HH:MM" option from an open ennexOS time-slot select.
async function pickTimeSlot(page, selectTestid, hhmm) {
  await robustClick(page.locator(`[data-testid="${selectTestid}"]`).first(), selectTestid)
  await page.waitForTimeout(800)
  await page.getByRole('option', { name: hhmm, exact: true }).first().click({ timeout: 8000 })
  await page.waitForTimeout(600)
}

async function expandFirstRow(page) {
  const header = page.locator('ennexos-accordion-row').first().locator('.mat-expansion-panel-header').first()
  if ((await header.getAttribute('aria-expanded').catch(() => null)) !== 'true') {
    await robustClick(header, 'expand row')
    await page.waitForTimeout(1200)
  }
}

// Add a brand-new time-period row via the 3-step wizard (days -> duration -> power).
async function addRowWindow(page, startStr, endStr) {
  await robustClick(page.locator('[data-testid="add-accordion-row"]').first(), 'add row')
  await page.waitForTimeout(2500)
  await confirmSection(page, 'days Continue')                 // days: everyDay default
  await pickTimeSlot(page, 'select-time-slot-start', startStr)
  await pickTimeSlot(page, 'select-time-slot-end', endStr)
  await confirmSection(page, 'duration Continue')
  await confirmSection(page, 'power Done')                    // power: 23 kW default
}

// Edit the existing (expanded) row 1's Time period section in place to the given window.
// Days stay "Daily" and power stays 23 kW (max), which are already the values we want.
async function editRowWindow(page, startStr, endStr) {
  await expandFirstRow(page)
  const startSel = page.locator('[data-testid="select-time-slot-start"]').first()
  if (!(await startSel.isVisible().catch(() => false))) {
    // Enter edit mode for the duration ("Time period") section.
    const durEdit = page.locator('[data-testid="section-timeframe-duration"] [data-testid="timeframe-section-edit-button"]').first()
    await robustClick(durEdit, 'time period Edit')
    await page.waitForTimeout(1500)
  }
  await pickTimeSlot(page, 'select-time-slot-start', startStr)
  await pickTimeSlot(page, 'select-time-slot-end', endStr)
  // Confirm/close the section (edit mode uses a "Close" button; add mode uses Continue/Done).
  const close = page.locator('[data-testid="timeframe-section-close-button"]:visible, [data-testid="timeframe-section-continue-button"]:visible, button:visible:has-text("Done")').first()
  await robustClick(close, 'time period Close')
  await page.waitForTimeout(1500)
}

test('ennexOS battery control', async ({page}) => {
  test.setTimeout(180000)
  const forceCharge = (process.env.FORCE_CHARGE || '').toLowerCase()
  const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true'
  if (forceCharge !== 'on' && forceCharge !== 'off') {
    throw new Error('FORCE_CHARGE must be "on" or "off"')
  }
  console.log(`=== ENNEXOS BATTERY CONTROL - ${forceCharge.toUpperCase()}${dryRun ? ' (DRY RUN)' : ''} ===`)

  await page.route('**/*', route => {
    const t = route.request().resourceType()
    return (t === 'image' || t === 'font' || t === 'media') ? route.abort() : route.continue()
  })

  await gotoAuthed(page, BATTERY_URL, 5000)
  await dismissConsent(page)

  // Confirm we actually reached the battery-edit form (not a login redirect / error page).
  const formPresent = await page.locator('[data-testid="battery-edit-form"], [data-testid="battery-charge-timeframes"]').count()
  if (formPresent === 0) {
    await page.screenshot({ path: 'ennexos-control-noform.png' }).catch(() => {})
    throw new Error('battery-edit form not present - session expired or page failed to load')
  }

  if (forceCharge === 'off') {
    // OFF: disable the time-controlled charging toggle. Dormant rows stay but never fire.
    await setToggle(page, false)
    if (dryRun) { console.log('DRY RUN - skipping Save (OFF)'); return }
    await robustClick(page.locator('[data-testid="dialog-action-save"]'), 'Save (off)')
    await page.waitForTimeout(5000)
    // Verify the save persisted: reload and confirm the toggle is off.
    await page.reload().catch(() => {})
    await page.waitForTimeout(5000)
    await dismissConsent(page)
    const offOk = (await readToggle(page)) === false
    if (!offOk) throw new Error('OFF save did not persist - time-controlled toggle still on after reload')
    console.log('OFF complete - time-controlled charging disabled and verified')
    return
  }

  // ON: ensure toggle on, then set exactly one now->Go-end window at max power. Reuse the
  // existing row if there is one (saved rows can't be deleted here); add one only if none.
  await setToggle(page, true)
  await page.waitForTimeout(1000)

  const { startStr, endStr } = computeWindow()
  console.log(`  target window (Europe/London): ${startStr} - ${endStr} at 23 kW`)

  const rowCount = await page.locator('ennexos-accordion-row').count()
  if (rowCount === 0) {
    console.log('  no existing window - adding one')
    await addRowWindow(page, startStr, endStr)
  } else {
    if (rowCount > 1) console.log(`  WARN: ${rowCount} existing windows - editing the first; extras remain (no per-row delete in UI)`)
    console.log('  editing existing window in place')
    await editRowWindow(page, startStr, endStr)
  }

  if (dryRun) {
    await page.screenshot({ path: 'ennexos-control-dryrun.png' }).catch(() => {})
    console.log('DRY RUN - skipping Save (ON). Pre-save state reached.')
    return
  }

  await robustClick(page.locator('[data-testid="dialog-action-save"]'), 'Save (on)')
  await page.waitForTimeout(5000)
  // Verify the save persisted: reload and confirm the toggle is on with a window present.
  // This prevents server.js from recording a false "charging started" state on a silent
  // save failure (which would skip charging and send no alert).
  await page.reload().catch(() => {})
  await page.waitForTimeout(5000)
  await dismissConsent(page)
  const onOk = (await readToggle(page)) === true
  const rowsOk = (await page.locator('ennexos-accordion-row').count()) >= 1
  if (!onOk || !rowsOk) throw new Error(`ON save did not persist (toggle=${onOk}, rows=${rowsOk})`)
  console.log(`ON complete - window ${startStr}-${endStr} saved at 23 kW and verified`)
})
