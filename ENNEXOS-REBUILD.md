# ennexOS migration — rebuild (DONE)

Sunny Portal moved from the classic ASP.NET UI to the **ennexOS SPA**
(`https://ennexos.sunnyportal.com/`, Angular Material). All old automation targeting the
classic UI is dead; the pipeline has been rebuilt. **Verified end-to-end against the live
plant on 2026-07-29.**

## Pipeline: the REST API (no browser) — `ennexosApi.js`

The ennexOS SPA is backed by a REST API. The whole pipeline now talks to it directly over
HTTPS — **no Chromium** — so a full run is ~1s and negligible RAM instead of ~20-40s and
hundreds of MB (the Pi was OOM-thrashing on headless Chrome).

- **Auth**: Keycloak **password grant** — one POST, no browser:
  `POST https://login.sma.energy/auth/realms/SMA/protocol/openid-connect/token`
  with `grant_type=password&client_id=SPpbeOS&username=&password=&scope=openid profile`.
  Token (~5 min) is cached in-memory and on disk (`.ennexos-token.json`, gitignored) so
  separate cron runs share it. `getData()`/`setForceCharge()` auto-refresh on 401.
- **Read** (`getData()`), all on `https://uiapi.sunnyportal.com/api/v1`:
  - `GET /widgets/energybalance?componentId={id}` → pvGeneration, totalConsumption,
    externalConsumption (grid import), batteryCharging/batteryDischarging, batteryStateOfCharge.
  - `GET /widgets/componentinfo?componentId={id}` → `BatteryCapacity` (Wh) and nominal PV.
  - `GET /plants/{id}/energymanagement` → `batteryManagementConfiguration.timeframeBasedBatteryCharging`
    (`.isActive` + `.timeframes[]`) = the force-charge state.
- **Control** (`setForceCharge(on)`), read-modify-write then verify:
  `PUT /plants/{id}/energymanagement/batteryConfig` with body
  `{priorityBasedBatteryCharging, timeframeBasedBatteryCharging:{isActive, timeframes:[{isNominalChargingPower:false, chargingPower:23000, timestampStartLocal:"HH:MM", timestampEndLocal:"HH:MM", validDays:[all 7]}]}, forecastBasedBatteryCharging}`.
  ON sets `isActive:true` + one now→Go-end window at 23 kW; OFF sets `isActive:false`.
  (Times are **plant-local = Europe/London**; the .env Go window 00:30-05:30 is **UTC**.)

Plant id `17318995` (override with `ENNEXOS_PLANT_ID`). PUT returns 200 with an empty body.

## Wiring
- `sma.js` `getAllInverterData()` → `EnnexosApi.getData()` (3 retries, alert email on failure).
- `server.js` `setCharge()` → `EnnexosApi.setForceCharge(true|false)`.
- Solar forecast: `forecast.js` (forecast.solar), called by `server.js` since the API/SPA
  exposes no PV forecast (its charts only fetch actual `Measurement.*` channels).

## Browser fallback (Playwright) — not used by the pipeline, kept for reference
`tests/ennexosData.test.js`, `tests/ennexosBatteryControl.test.js`, `tests/ennexosSession.js`
(self-healing auth), `tests/ennexosAuth.test.js` do the same reads/control by driving the SPA
in Chromium. Superseded by the API but retained as a fallback if SMA changes the API. Their
selectors/wizard are documented in memory `ennexos-timeframe-selectors`.

## Still to do (follow-ups)
1. **Re-enable cron on the Pi.** It is still PAUSED (`PAUSED-REBUILD` markers). After pulling
   these changes, just uncomment the crontab lines — no auth seeding needed (the API logs in
   automatically via password grant). The `flock -n .playwright.lock` guard is no longer needed
   for the main pipeline (no Chromium), though it's harmless to keep.
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
