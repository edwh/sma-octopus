require('dotenv').config()
const nodemailer = require('nodemailer')

// Debug logging utility
const DEBUG = process.env.DEBUG === 'true'
function debug(message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString()
    if (data !== null) {
      console.log(`[DEBUG ${timestamp}] EMAIL: ${message}:`, data)
    } else {
      console.log(`[DEBUG ${timestamp}] EMAIL: ${message}`)
    }
  }
}

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true'
debug('Email system initialized', { EMAIL_ENABLED })

let transporter = null

if (EMAIL_ENABLED) {
  debug('Creating email transporter', {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ? '[SET]' : '[NOT SET]',
    pass: process.env.SMTP_PASS ? '[SET]' : '[NOT SET]'
  })
  
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  })
  debug('Email transporter created successfully')
} else {
  debug('Email disabled - no transporter created')
}

exports.sendChargingStartedEmail = async function(forecastData = {}) {
  debug('sendChargingStartedEmail called', forecastData)
  if (!EMAIL_ENABLED || !transporter) {
    debug('Email disabled or no transporter - skipping email')
    console.log('Email notifications disabled')
    return
  }

  try {
    let subject = 'Battery Charging Started'
    let text = `Battery charging has been turned ON at ${new Date().toLocaleString()}`
    
    // Add forecast information if available
    if (forecastData.forecastedGeneration !== null && forecastData.forecastedGeneration !== undefined) {
      text += `\n\n📈 Solar Forecast: ${forecastData.forecastedGeneration} kWh expected today`
      
      if (forecastData.adjustedTargetSOC !== undefined && forecastData.originalTargetSOC !== undefined) {
        text += `\n🎯 Target SOC: ${forecastData.adjustedTargetSOC.toFixed(1)}% (adjusted from ${forecastData.originalTargetSOC}%)`
        text += `\n💡 Charging reduced by ${forecastData.forecastAdjustment.toFixed(1)}% due to expected solar generation`
      }
    } else {
      text += `\n\n⚠️ No solar forecast data available - using standard target SOC`
    }
    
    // Add current state information
    if (forecastData.currentSOC !== undefined) {
      text += `\n🔋 Current SOC: ${forecastData.currentSOC}%`
    }
    
    if (forecastData.currentConsumption !== undefined) {
      text += `\n⚡ Current consumption: ${(forecastData.currentConsumption / 1000).toFixed(2)} kW`
    }
    
    // Add comprehensive system status
    text += `\n\n=== SYSTEM STATUS ===`
    if (forecastData.pvGeneration !== undefined && forecastData.pvGeneration !== null) {
      text += `\n☀️ PV generation: ${(forecastData.pvGeneration / 1000).toFixed(2)} kW`
    }
    if (forecastData.purchasedElectricity !== undefined && forecastData.purchasedElectricity !== null) {
      text += `\n🏠 Grid purchase: ${(forecastData.purchasedElectricity / 1000).toFixed(2)} kW`
    }
    if (forecastData.batteryCharging !== undefined && forecastData.batteryCharging !== null) {
      text += `\n🔋 Battery charging: ${(forecastData.batteryCharging / 1000).toFixed(2)} kW`
    }
    
    // Add Octopus Go window info
    const now = new Date()
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0')
    const startTime = process.env.OCTOPUS_GO_START_TIME || '00:30'
    const endTime = process.env.OCTOPUS_GO_END_TIME || '05:30'
    
    text += `\n\n=== OCTOPUS GO ===`
    text += `\n⏰ Time: ${currentTime}`
    text += `\n🕐 Window: ${startTime} - ${endTime}`

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: subject,
      text: text
    }
    debug('Sending charging started email', { 
      from: mailOptions.from, 
      to: mailOptions.to, 
      subject: mailOptions.subject 
    })

    await transporter.sendMail(mailOptions)
    debug('Charging started email sent successfully')
    console.log('Charging started email sent')
  } catch (error) {
    debug('Error sending charging started email', error)
    console.error('Error sending charging started email:', error)
  }
}

exports.sendChargingStoppedEmail = async function(kWhCharged = null, socIncrease = null, estimatedCost = null, forecastData = {}) {
  debug('sendChargingStoppedEmail called', { kWhCharged, socIncrease, estimatedCost, forecastData })
  if (!EMAIL_ENABLED || !transporter) {
    debug('Email disabled or no transporter - skipping email')
    console.log('Email notifications disabled')
    return
  }

  try {
    let subject = 'Battery Charging Stopped'
    let text = `Battery charging has been turned OFF at ${new Date().toLocaleString()}`
    
    // Build subject line with all available data
    let subjectParts = []
    
    if (kWhCharged !== null && !isNaN(kWhCharged)) {
      const kWhFormatted = kWhCharged.toFixed(2)
      subjectParts.push(`${kWhFormatted} kWh`)
      text += `\n⚡ Total kWh charged: ${kWhFormatted} kWh`
      debug('Including kWh in email', kWhCharged)
    } else {
      text += `\n⚡ kWh charged: Unknown (battery capacity not available or calculation error)`
      debug('No kWh data available for email', { kWhCharged })
    }
    
    if (socIncrease !== null && !isNaN(socIncrease)) {
      subjectParts.push(`+${socIncrease}%`)
      text += `\n🔋 SOC increase: ${socIncrease}%`
      debug('Including SOC increase in email', socIncrease)
    }
    
    if (estimatedCost !== null && !isNaN(estimatedCost)) {
      const costFormatted = estimatedCost.toFixed(2)
      subjectParts.push(`£${costFormatted}`)
      text += `\n💷 Estimated cost: £${costFormatted}`
      debug('Including estimated cost in email', estimatedCost)
    }
    
    // Add forecast decision logic information
    if (forecastData.forecastedGeneration !== null && forecastData.forecastedGeneration !== undefined) {
      text += `\n\n📈 Solar Forecast: ${forecastData.forecastedGeneration} kWh expected today`
      if (forecastData.adjustedTargetSOC !== undefined && forecastData.originalTargetSOC !== undefined) {
        text += `\n🎯 Target SOC was adjusted from ${forecastData.originalTargetSOC}% to ${forecastData.adjustedTargetSOC.toFixed(1)}%`
        text += `\n💡 Saved ~${forecastData.forecastAdjustment.toFixed(1)}% charging due to expected solar generation`
        
        // Calculate approximate savings
        if (forecastData.forecastAdjustment > 0 && forecastData.batteryCapacity) {
          const savedkWh = (forecastData.forecastAdjustment / 100) * forecastData.batteryCapacity
          const octopusGoRate = parseFloat(process.env.OCTOPUS_GO_RATE) || 8.5
          const savedCost = savedkWh * (octopusGoRate / 100)
          text += `\n💰 Estimated savings: ${savedkWh.toFixed(2)} kWh (£${savedCost.toFixed(2)})`
        }
      }
    } else {
      text += `\n\n⚠️ No solar forecast data was available for this charging session`
    }
    
    if (subjectParts.length > 0) {
      subject += ` - ${subjectParts.join(', ')}`
    } else {
      subject += ' - Details Unknown'
    }

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: subject,
      text: text
    }
    debug('Sending charging stopped email', { 
      from: mailOptions.from, 
      to: mailOptions.to, 
      subject: mailOptions.subject 
    })

    await transporter.sendMail(mailOptions)
    debug('Charging stopped email sent successfully')
    console.log('Charging stopped email sent')
  } catch (error) {
    debug('Error sending charging stopped email', error)
    console.error('Error sending charging stopped email:', error)
  }
}

exports.sendErrorEmail = async function(errorType, errorMessage, errorDetails = {}) {
  debug('sendErrorEmail called', { errorType, errorMessage, errorDetails })
  if (!EMAIL_ENABLED || !transporter) {
    debug('Email disabled or no transporter - skipping error email')
    console.log('Error email notifications disabled')
    return
  }

  try {
    const timestamp = new Date().toLocaleString()
    const subject = `SMA Octopus Error - ${errorType}`
    
    let text = `An error occurred in the SMA Octopus system at ${timestamp}\n\n`
    text += `Error Type: ${errorType}\n`
    text += `Error Message: ${errorMessage}\n\n`
    
    // Add detailed error information
    if (errorDetails.script) {
      text += `Script: ${errorDetails.script}\n`
    }
    
    if (errorDetails.operation) {
      text += `Operation: ${errorDetails.operation}\n`
    }
    
    if (errorDetails.stdout) {
      text += `\nScript Output (stdout):\n${errorDetails.stdout}\n`
    }
    
    if (errorDetails.stderr) {
      text += `\nScript Errors (stderr):\n${errorDetails.stderr}\n`
    }
    
    if (errorDetails.stackTrace) {
      text += `\nStack Trace:\n${errorDetails.stackTrace}\n`
    }
    
    if (errorDetails.systemInfo) {
      text += `\nSystem Info:\n`
      Object.keys(errorDetails.systemInfo).forEach(key => {
        text += `  ${key}: ${errorDetails.systemInfo[key]}\n`
      })
    }
    
    if (errorDetails.environment) {
      text += `\nEnvironment Variables:\n`
      Object.keys(errorDetails.environment).forEach(key => {
        // Don't expose sensitive data
        if (key.includes('PASS') || key.includes('SECRET') || key.includes('TOKEN')) {
          text += `  ${key}: [REDACTED]\n`
        } else {
          text += `  ${key}: ${errorDetails.environment[key]}\n`
        }
      })
    }
    
    text += `\n---\nThis is an automated error notification from the SMA Octopus system.`

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: subject,
      text: text
    }
    
    debug('Sending error email', { 
      from: mailOptions.from, 
      to: mailOptions.to, 
      subject: mailOptions.subject,
      textLength: text.length
    })

    await transporter.sendMail(mailOptions)
    debug('Error email sent successfully')
    console.log('Error email sent for:', errorType)
  } catch (error) {
    debug('Error sending error email', error)
    console.error('Failed to send error email:', error)
  }
}