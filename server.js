require('swagger-client')
const SMA = require('./sma.js')
const Octopus = require('./octopus.js')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

let charge = false

async function setCharge (on) {
  if (on) {
    const {stdout, stderr} = await exec('npx playwright test batteryOn.test.js')
    console.log('Charging battery...', stdout, stderr)
  } else {
    const {stdout, stderr} = await exec('npx playwright test batteryOff.test.js')
    console.log('Not charging battery...', stdout, stderr)
  }
}

async function main () {
  const stateOfCharge = await SMA.getStateOfCharge()
  const shouldCharge = await Octopus.shouldCharge(stateOfCharge)

  if (shouldCharge) {
    // We know it's worth charging now.
    await setCharge(shouldCharge)
  } else {
    // We shouldn't be charging, or failed to work out whether we should.  Don't charge.
    await setCharge(false)
  }
}

main()