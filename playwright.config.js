const {defineConfig, devices} = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: 'line',
  reportSlowTests: null,
  use: {
    trace: 'on-first-retry',
  },

  // We only need Chrome.
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
  ],
})

