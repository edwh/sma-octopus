const CHEAP_PERCENTILE = 25
const MODERATE_PERCENTILE = 25
const CHEAP_THRESHOLD = 60
const MODERATE_THRESHOLD = 30

exports.getPrices = async function () {
  let ret = null
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const url = 'https://api.octopus.energy/v1/products/AGILE-FLEX-22-11-25/electricity-tariffs/E-1R-AGILE-FLEX-22-11-25-C/standard-unit-rates/?' +
    'period_from=' + start + '&' +
    'period_to=' + end

  const res = await fetch(url)

  if (res.ok) {
    data = await res.json()
  }

  return data
}

exports.shouldCharge = async function (stateOfCharge) {
  let charge = false

  const prices = await exports.getPrices()

  // Find median price.
  prices.results.sort((a, b) => a.value_inc_vat - b.value_inc_vat)
  const median = prices.results[Math.floor(prices.results.length / 2)].value_inc_vat

  const cheap = prices.results[Math.floor(prices.results.length * CHEAP_PERCENTILE / 100)].value_inc_vat
  const moderate = prices.results[Math.floor(prices.results.length * MODERATE_PERCENTILE / 100)].value_inc_vat

  // Find the current price
  const now = new Date()
  const current = prices.results.find(price => new Date(price.valid_from) <= now && new Date(price.valid_to) >= now).value_inc_vat

  if (current) {
    if (current <= cheap && stateOfCharge <= CHEAP_THRESHOLD) {
      // We have a cheap price and our battery isn't getting full so charge.
      console.log('Price is cheap (', current, 'vs', cheap, ', median ', median, ') and state of charge is low (', CHEAP_THRESHOLD, ') so charge.')
      charge = true
    } else if (current <= moderate && stateOfCharge <= MODERATE_THRESHOLD) {
      // We have a moderate price and our battery is getting empty so charge.
      charge = true
      console.log('Price is moderate (', current, 'vs', moderate, ', median ', median, ') and state of charge is very low (', MODERATE_THRESHOLD, ') so charge.')
    } else {
      // It's an expensive period, so just pay the current price.
      console.log('Price is too high (', current, ', median ', median, ') or state of charge is too high (', stateOfCharge, ') so do not charge.')
    }
  } else {
    console.log('No current price found.')
  }

  return charge
}