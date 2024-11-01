const {expect} = require('@playwright/test')

exports.setCharging = async function (page, val) {
  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.click('#lDeviceParameter')
  await page.click('#bParameterEdit')
  const batterySection = page.locator('span', {
    hasText: 'Battery'
  }).first()
  await batterySection.click()
  const applicationSection = page.locator('span', {
    hasText: 'Areas of application'
  }).first()

  const selfConsumption = page.locator('td', {
    hasText: 'Minimum width of self-consumption area'
  })

  const selfConsumptionRow = await selfConsumption.locator('..').first()
  const selfConsumptionInput = await selfConsumptionRow.locator('input').first()

  // Finally.  Setting this value low can force the battery to charge.
  await selfConsumptionInput.fill(val)

  // Save the changes.
  await page.locator('button', {
    hasText: 'Save all'
  }).click()

  return page
}

exports.getStateOfCharge = async function (page) {
  await page.setViewportSize({width: 2048, height: 1536})

  await page.goto('http://' + process.env.inverterIP + '/#/login')
  await page.selectOption('select[name="username"]', 'Installer')
  await page.locator('input[name="password"]').pressSequentially(process.env.installerPassword)
  await page.click('#bLogin')
  await page.click('#lSpotValues')
  const batterySection = await page.locator('span', {
    hasText: 'Battery'
  }).first()
  await batterySection.click()

  // Wait for section to expand - doesn't seem to work using normal Playwright waits.
  await page.waitForTimeout(5000)
  const socPercent = page.locator('td', {
    hasText: 'State of charge'
  })

  const socRow = await socPercent.locator('..').first()
  const socValue = await socRow.locator('.ng-scope').locator('nth=1').first()
  // await socValue.scrollIntoViewIfNeeded()
  let value = await socValue.innerText()
  value = value.replace(' ', '').replace('%', '')
  console.log('SOC', value)
  value = parseInt(value)

  expect(value).toBeGreaterThan(0)
  expect(value).toBeLessThan(100)

  return value
}