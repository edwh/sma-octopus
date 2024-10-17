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