# ennexOS migration — rebuild handoff

**Root cause of the recent failures:** Sunny Portal migrated from the old classic ASP.NET
UI (`www.sunnyportal.com/Templates/*.aspx`) to the new **ennexOS SPA**
(`https://ennexos.sunnyportal.com/`, Angular Material). Every existing automation targets
the old UI and is now broken:
- `tests/getForecastData.test.js` / `sma.js` (SOC + power + charge-state scrape)
- `tests/simpleBatteryControl.test.js` (FORCE_CHARGE on/off)
- `tests/checkChargeEditor.test.js`, `standby-monitor.js` premise (the "editor unreachable /
  standby" symptom was really this migration; battery was *draining*, not in standby).

**Cron is PAUSED** during the rebuild: crontab lines are commented with `PAUSED-REBUILD`
(backup: `scratchpad/crontab-backup.txt`). Re-enable once the new scripts work. All jobs
run under a shared `flock -n .playwright.lock` (the Pi OOMs if two Chromium run at once).

## What's needed
1. **New data scrape** (replace getForecastData/sma.js): read SOC, PV, consumption, grid,
   battery flow, and charge-window state from ennexOS.
2. **New ON script**: ensure time-controlled charging is on + a time period covering now→Go
   end at max power, then Save.
3. **New OFF script**: remove the time period(s), Save.
4. Rewire `server.js` `setCharge()` to call the new ON/OFF scripts.

## ennexOS facts established (see `tests/exploreEnnexos*.test.js`, `tests/ennexosAuth.test.js`)
- **Plant id: `17318995`**.
- **Login (2-step, flaky):** `https://ennexos.sunnyportal.com/login` → click ennexOS Login
  button `[data-testid="button-primary"]` → SMA ID form (`login.sma.energy`,
  `input[name="username"]` / `input[name="password"]` / submit) → back to
  `/17318995/dashboard`. **Prefer reusing a saved session:** `tests/ennexosAuth.test.js`
  logs in and writes `.ennexos-auth.json` (gitignored); other tests do
  `test.use({ storageState: '.ennexos-auth.json' })` and skip login. Re-run the auth test
  when the session expires.
- **MEMORY: MUST block images/fonts/media** or the SPA OOM-crashes Chromium on this 898MB
  Pi (`page.route('**/*', r => ['image','font','media'].includes(r.request().resourceType()) ? r.abort() : r.continue())`).
  Even so it's occasionally flaky; retries + saved-auth help a lot.
- **Cookie consent = consentmanager (cmpbox).** Dismiss: click `.cmpboxbtnyes` (or
  `button:has-text("Accept all")`), then `document.querySelectorAll('#cmpwrapper,#cmpbox,[class*="cmpbox"],[id*="cmp"]').forEach(e=>e.remove())`.
- **Battery config page:**
  `https://ennexos.sunnyportal.com/17318995/configuration/view-autonomous-energy-management-configuration/battery-edit`
  Form testid `battery-edit-form`. Three modes: forecast-based, priority-based, and
  **time-controlled** (the force-charge equivalent).
- **Time-controlled charging section** (`data-testid="battery-charge-timeframes"`):
  - Toggle: `[data-testid="timeframe-based-battery-charging-toggle"]` (inner
    `#mat-mdc-slide-toggle-2-button`, `role=switch`; currently ON / `aria-checked=true`).
  - Add a period: `[data-testid="add-accordion-row"]` → appends a new
    `ennexos-accordion-row` (`[data-testid="accordion-row"]`), auto-expanded, defaulting to
    **23.00 kW** with times "not defined" (shows an error icon until times are set).
  - Each row: `[data-testid="accordion-index"]` (1,2,…),
    `[data-testid="timeframe-config"]` (e.g. "Daily, 3:04 AM - 3:34 AM"),
    `[data-testid="charging-power"]` ("23.00 kW"). A leftover row **"Daily 03:04-03:34
    23.00 kW"** currently exists.
  - Save: `[data-testid="button-primary"]` ("Save"). Cancel: `[data-testid="button-secondary"]`.

## STILL UNKNOWN (the two blockers to finish)
- **Add/edit form field selectors** (start-time, end-time inputs) inside a newly-added
  expanded row's body (`.mat-expansion-panel.mat-expanded .mat-expansion-panel-body`).
  NOTE: expanding an *existing* complete row shows an EMPTY body — the edit fields only
  render for a *newly added* row. Capture: with saved auth, open battery-edit, dismiss
  consent, click `add-accordion-row`, wait, dump that expanded body's inputs.
- **Delete control** for removing a time period (needed for OFF). Look in the new/expanded
  row body and row header for a delete/trash button (`[data-icon*="delete"]`, aria "Delete").

## Notes
- `server.js` still has the user's pre-existing WIP plus my `isEditorUnavailableError`
  guard — left uncommitted intentionally.
- Reboot cleared the earlier swap-thrash; keep an eye on memory during SPA runs.
