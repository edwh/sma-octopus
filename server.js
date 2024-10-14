require('swagger-client');
const SMA = require('./sma.js')

SMA.getAccessToken().then((accessToken) => {
  // console.log('Access Token', accessToken)
  SMA.login(accessToken).then(async (success) => {
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
