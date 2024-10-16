const {test, expect} = require('@playwright/test')
const {setCharging} = require('./utils')
test('Set battery charging', async ({page}) => {
  await setCharging(page, '1')
})