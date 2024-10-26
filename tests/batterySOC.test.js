const {test, expect} = require('@playwright/test')
const {getStateOfCharge} = require('./utils')
test('Get battery state of charge', async ({page}) => {
  await getStateOfCharge(page)
})