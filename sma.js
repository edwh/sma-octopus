const {PageTest} = require('@playwright/test')
const Octopus = require('./octopus')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

exports.getAccessToken = async function () {
  // As per https://developer.sma.de/api-access-control#c59491
  let accessToken = null

  // console.log('Client ID', process.env.clientId)
  // console.log('Client Secret', process.env.clientSecret)

  const res = await fetch('https://auth.smaapis.de/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      'client_id': process.env.clientId,
      'client_secret': process.env.clientSecret,
      'grant_type': 'client_credentials',
    })
  })

  // console.log('Res',res)

  if (res.ok) {
    const data = await res.json()
    // console.log('Data', data)

    if (data.access_token) {
      accessToken = data.access_token
    }
  } else {
    console.log('Error getting access token', res.statusText)
  }

  return accessToken
}

exports.loginToAPI = async function (accessToken) {
  let ret = false

  // As per https://developer.sma.de/api-access-control#c59491
  //
  // First time we run this, it'll trigger an email to give us permission.
  // console.log('Log in as', process.env.ownerEmail, accessToken)
  const res = await fetch('https://async-auth.smaapis.de/oauth2/v2/bc-authorize', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      'loginHint': process.env.ownerEmail,
    })
  })

  // console.log('Res',res)

  if (res.ok) {
    const data = await res.json()
    // console.log('Data', data)
    const state = data?.state
    // console.log('Login state', state)

    if (state === 'Pending') {
      console.log('You should have an email to grant access.')
    } else if (state === 'Accepted') {
      // console.log('Logged in successfully.')
      ret = true
    } else {
      console.log('Unknown login state', data)
    }
  } else {
    console.log('Error', res.statusText)
  }

  return ret
}

exports.getStateOfCharge = async function () {
  let stateOfCharge = null
  try {
    const {stdout, stderr} = await exec('npx playwright test batterySOC.test.js')

    // Parse output and find SOC x
    const lines = stdout.split('\n')
    for (const line of lines) {
      if (line.includes('SOC ')) {
        stateOfCharge = line.split(' ')[1]
        break
      }
    }
  } catch (e) {
    console.log('Error getting SOC', e)
  }

  console.log('Got SOC', stateOfCharge)

  return stateOfCharge
}