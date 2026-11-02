// Octopus Go's cheap window is 00:30 to 05:30 GMT all year (it does not move for BST).
// It is half-open: 00:30 is cheap, 05:30 is already peak. The cron job fires a few
// seconds after 05:30, so an inclusive end arms a peak-rate charge every morning.
const { test } = require('node:test')
const assert = require('node:assert')

process.env.OCTOPUS_GO_ENABLED = 'true'
process.env.OCTOPUS_GO_START_TIME = '00:30'
process.env.OCTOPUS_GO_END_TIME = '05:30'
const { isWithinOctopusGoWindow } = require('../octopus.js')

const RealDate = Date
function at (iso, fn) {
  global.Date = class extends RealDate {
    constructor (...args) { if (args.length) super(...args); else super(iso) }
    static now () { return new RealDate(iso).getTime() }
  }
  try { return fn() } finally { global.Date = RealDate }
}

const cases = [
  ['2026-11-02T00:29:59Z', false],
  ['2026-11-02T00:30:00Z', true],
  ['2026-11-02T03:00:00Z', true],
  ['2026-11-02T05:29:59Z', true],
  ['2026-11-02T05:30:00Z', false],
  ['2026-11-02T05:30:08Z', false], // when the cron run actually fires
  ['2026-07-15T00:30:00Z', true], // summer: 01:30 BST, still the GMT window
  ['2026-07-15T05:30:08Z', false] // summer: 06:30 BST, peak
]
for (const [iso, expected] of cases) {
  test(`${iso} is ${expected ? 'inside' : 'outside'} the Octopus Go window`, () => {
    assert.strictEqual(at(iso, () => isWithinOctopusGoWindow()), expected)
  })
}
