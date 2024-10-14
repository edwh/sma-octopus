require('swagger-client');

async function getAccessToken() {
  // As per https://developer.sma.de/api-access-control#c59491
  let accessToken = null

  // console.log('Client ID', process.env.clientId)
  // console.log('Client Secret', process.env.clientSecret)

  const res  = await fetch('https://auth.smaapis.de/oauth2/token', {
    method: 'POST',
    headers:{
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

async function login(accessToken) {
  let ret = false

  // As per https://developer.sma.de/api-access-control#c59491
  //
  // First time we run this, it'll trigger an email to give us permission.
  // console.log('Log in as', process.env.ownerEmail, accessToken)
  const res  = await fetch('https://async-auth.smaapis.de/oauth2/v2/bc-authorize', {
    method: 'POST',
    headers:{
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

getAccessToken().then((accessToken) => {
  // console.log('Access Token', accessToken)
  login(accessToken).then(async (success) => {
    if (success) {
      // console.log('Successfully logged in.')

      let res = await fetch('https://monitoring.smaapis.de/v1/plants', {
        method: 'GET',
        headers:{
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        }
      })

      if (res.ok) {
        const plants = await res.json()
        console.log('Plants', plants)

        if (plants) {
          // Assume only one plant.
          const plant = plants.plants[0]
          // console.log('Plant', plant)
          const plantId = plant?.plantId
          // console.log('Plant ID', plantId)

          if (plantId) {
            res = await fetch(`https://monitoring.smaapis.de/v1/plants/${plantId}/devices`, {
              method: 'GET',
              headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
              }
            })

            if (res.ok) {
              const devices = await res.json()
              // console.log('Devices', devices)

              // Find entry with type 'Battery Inverter'
              const batteryInverter = devices.devices.find(device => device.type === 'Battery Inverter')
              // console.log('Battery Inverter', batteryInverter)

              res = await fetch(`https://monitoring.smaapis.de/v1/devices/${batteryInverter.deviceId}`, {
                method: 'GET',
                headers: {
                  'Authorization': 'Bearer ' + accessToken,
                  'Content-Type': 'application/json'
                }
              })

              if (res.ok) {
                const device = await res.json()
                // console.log('Inverter device', device)

                // Get current state of charge.
                res = await fetch(`https://monitoring.smaapis.de/v1/devices/${batteryInverter.deviceId}/measurements/sets/EnergyAndPowerBattery/Recent`, {
                  method: 'GET',
                  headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'application/json'
                  }
                })

                if (res.ok) {
                  const measurements = await res.json()
                  console.log('Measurements', measurements)

                  const stateOfCharge = measurements.set[0]?.batteryStateOfCharge
                  console.log('State of charge', stateOfCharge, JSON.stringify(measurements.set[0]?.batteryStateOfChargeArray))
                } else {
                  console.log('Error getting measurements', res.statusText)
                }
              }
            } else {
              console.log('Error getting devices', res.statusText)
            }
          }
        }
      }
    }
  })
})


//
//
// var fs = require('fs'), // needed to read JSON file from disk
//   Collection = require('postman-collection').Collection,
//   myCollection;
// const {AuthorizationCode} = require('simple-oauth2')
//
// // Load a collection to memory from a JSON file on disk (say, sample-collection.json)
// myCollection = new Collection(JSON.parse(fs.readFileSync('postman_collection.json').toString()));
//
// // log items at root level of the collection
// // console.log(myCollection.toJSON());

// const monitoring = new SwaggerClient('https://sandbox.smaapis.de/monitoring/swagger/v1/swagger.json');
