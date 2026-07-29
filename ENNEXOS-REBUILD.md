# ennexOS migration — rebuild (DONE)

Sunny Portal moved from the classic ASP.NET UI to the **ennexOS SPA**
(`https://ennexos.sunnyportal.com/`, Angular Material). All old automation targeting the
classic UI is dead; the pipeline has been rebuilt against ennexOS. **Verified end-to-end
against the live plant on 2026-07-29** (real ON → battery force-charged at ~4.6 kW → real
OFF → charging stopped).

## New scripts (replace the old ones)
- **`tests/ennexosSession.js`** — shared **self-healing auth** helper. `gotoAuthed(page, url)`
  reuses the saved `.ennexos-auth.json` session (fast path) and, if it has expired, detects the
  login redirect, performs the 2-step ennexOS → SMA ID login inline, re-saves the session, and
  continues. Both the scrape and control scripts use it, so a stale session never fails a run.
- **`tests/ennexosAuth.test.js`** — standalone login that just seeds `.ennexos-auth.json`
  (handy for the first run on a new machine/Pi; not required by the pipeline any more).
- **`tests/ennexosData.test.js`** — read-only scrape. Emits marker lines parsed by `sma.js`:
  `SOC_FROM_ENNEXOS`, `CAPACITY_FROM_ENNEXOS`, `PV_GENERATION_W`, `CONSUMPTION_W`,
  `BATTERY_POWER_W` (signed: + charging / − discharging), `FORCE_CHARGE_WINDOWS_FOUND`,
  `FORCE_CHARGE_ACTIVE` (toggle on AND a window covers now). Reads the dashboard, then the
  battery-edit page for force-charge state.
- **`tests/ennexosBatteryControl.test.js`** — `FORCE_CHARGE=on|off` (and `DRY_RUN=true` to
  stop before Save). ON: enable the time-controlled toggle + set ONE window now→Go-end at
  max power (23 kW), reusing the existing row (edits it in place — saved rows have no delete
  control in this UI) or adding one if none. OFF: disable the toggle. Both verify the save
  persisted after a reload (so a silent save failure surfaces as an error, not a false
  "charging started" state).

## Wiring
- `sma.js` `getAllInverterData()` runs `ennexosAuth.test.js ennexosData.test.js` and parses
  the markers. `forecastedGeneration` is currently `null` (see follow-ups).
- `server.js` `setCharge()` runs `ennexosBatteryControl.test.js` (FORCE_CHARGE on/off).

## Key ennexOS facts (see also memory: ennexos-timeframe-selectors)
- Plant id `17318995`. Plant/UI time = **Europe/London**; .env Go window (00:30–05:30) is
  **UTC** — convert before picking slots.
- MUST block images/fonts/media (`page.route`) or the SPA OOMs Chromium on the 898 MB Pi.
- Battery-edit is a dialog; form **Save = `[data-testid="dialog-action-save"]`**.
- Time-controlled section `[data-testid="battery-charge-timeframes"]`: toggle
  `timeframe-based-battery-charging-toggle`; rows are `<ennexos-accordion-row>`; add via
  `add-accordion-row` (wizard: days → duration `select-time-slot-start`/`-end` 5-min slots →
  power, default 23 kW). Existing rows are edited via `section-timeframe-duration`'s Edit.
- When the toggle is OFF the SPA hides the window rows (scrape then reports 0 windows).

## Still to do (follow-ups)
1. **Re-enable cron on the Pi.** It is still PAUSED (`PAUSED-REBUILD` markers). After pulling
   these changes and running `ennexosAuth.test.js` once on the Pi to seed `.ennexos-auth.json`,
   uncomment the crontab lines. All jobs share `flock -n .playwright.lock`.
2. **Solar forecast** — DONE via `forecast.js` (forecast.solar API), because ennexOS exposes
   no PV forecast (its charts only fetch actual `Measurement.*` channels; the old forecast came
   from the dead classic Sunny Portal page). `server.js` calls it when the scrape returns no
   forecast. **To enable, set `SOLAR_FORECAST_LAT`/`LON` (and optionally DECLINATION/AZIMUTH/
   KWP/MULTIPLIER) in .env** — see `.env.example`. Until then `forecastedGeneration=null` and
   the system charges to base targets (safe, just less optimal on sunny days).
3. **Dead files** can be removed once cron is confirmed working: `tests/getForecastData.test.js`,
   `tests/simpleBatteryControl.test.js`, `tests/checkChargeEditor.test.js`, `standby-monitor.js`,
   `tests/exploreEnnexos*.test.js`, `tests/exploreConsent.test.js` (old-UI or one-off probes).
4. **Standby detection** (`standby-monitor.js` + `checkChargeEditor.test.js`) targeted the old
   UI; the "editor unreachable" symptom was really this migration. Rebuild against ennexOS if
   still wanted (e.g. detect inverter offline from the dashboard state widget).
