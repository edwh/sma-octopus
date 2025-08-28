const {defineConfig, devices} = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line', // Change to html to view the errors, but this will block execution.
  reportSlowTests: null,
  timeout: 5 * 60 * 1000,  // On a Raspberry pi, this can take a while. Extended for battery control.
  use: {
    trace: 'off',
  },

  // We only need Chrome.
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
  ],
})

