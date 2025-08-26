require('dotenv').config()
const {test, expect} = require('@playwright/test')
const {getAllInverterData} = require('./utils')

test('Get all inverter data in single session', async ({page}) => {
  await getAllInverterData(page)
})