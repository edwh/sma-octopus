const {test, expect} = require('@playwright/test')
const {setCharging} = require('./utils')
test('Set battery charging off', async ({page}) => {
  await setCharging(page, '91')
})