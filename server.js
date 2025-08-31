require('dotenv').config()
const SMA = require('./sma.js')
const Octopus = require('./octopus.js')
const Email = require('./email.js')
const fs = require('fs')
const path = require('path')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

// File lock functionality
const LOCK_FILE = path.join(__dirname, '.server.lock')
const LOCK_TIMEOUT = 15 * 60 * 1000 // 15 minutes in milliseconds

function acquireLock() {
  try {
    // Check if lock file exists and is recent
    if (fs.existsSync(LOCK_FILE)) {
      const lockStat = fs.statSync(LOCK_FILE)
      const lockAge = Date.now() - lockStat.mtime.getTime()
      
      if (lockAge < LOCK_TIMEOUT) {
        console.log('🔒 Another instance is already running. Exiting.')
        console.log(`Lock file age: ${Math.round(lockAge / 1000)}s (timeout: ${LOCK_TIMEOUT / 1000}s)`)
        process.exit(1)
      } else {
        console.log('🔓 Stale lock file detected, removing...')
        fs.unlinkSync(LOCK_FILE)
      }
    }
    
    // Create lock file with current timestamp
    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      startTime: new Date().toISOString(),
      hostname: require('os').hostname()
    }))
    
    console.log('🔒 Lock acquired for process', process.pid)
    
    // Clean up lock file on exit
    process.on('exit', releaseLock)
    process.on('SIGINT', () => { releaseLock(); process.exit(0) })
    process.on('SIGTERM', () => { releaseLock(); process.exit(0) })
    process.on('uncaughtException', (err) => { 
      console.error('Uncaught exception:', err)
      releaseLock()
      process.exit(1) 
    })
    
  } catch (error) {
    console.error('❌ Failed to acquire lock:', error.message)
    process.exit(1)
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE)
      console.log('🔓 Lock released')
    }
  } catch (error) {
    console.error('Warning: Failed to release lock:', error.message)
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const FORCE_OCTOPUS_GO_WINDOW = args.includes('--force-window') || args.includes('-f')
const SHOW_HELP = args.includes('--help') || args.includes('-h')
const RUN_ONCE = args.includes('--once') || args.includes('-o')

// Show help and exit if requested
if (SHOW_HELP) {
  console.log(`
SMA Octopus Battery Management System

Usage: node server.js [options]

Options:
  -f, --force-window    Force the system to act as if it's within the Octopus Go time window
  -o, --once           Run once and exit (default: run continuously)
  -h, --help           Show this help message

Environment Variables:
  DEBUG=true                Enable detailed debug logging
  OCTOPUS_GO_ENABLED        Enable Octopus Go mode (true/false)
  CHECK_INTERVAL_MINUTES    Minutes between checks (default: 5)
  
Examples:
  node server.js                    # Continuous operation (default)
  node server.js --once             # Run once and exit
  node server.js --force-window     # Test charging logic outside normal hours
  DEBUG=true node server.js         # Run with debug logging
`)
  process.exit(0)
}

// Debug logging utility
const DEBUG = process.env.DEBUG === 'true'
function debug(message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString()
    if (data !== null) {
      console.log(`[DEBUG ${timestamp}] ${message}:`, data)
    } else {
      console.log(`[DEBUG ${timestamp}] ${message}`)
    }
  }
}


// Configuration
const CHECK_INTERVAL_MINUTES = parseInt(process.env.CHECK_INTERVAL_MINUTES) || 5
const CHECK_INTERVAL_MS = CHECK_INTERVAL_MINUTES * 60 * 1000

// Signal handling for graceful shutdown
let isShuttingDown = false
let currentTimeout = null

function gracefulShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)
  
  if (currentTimeout) {
    clearTimeout(currentTimeout)
    debug('Cleared scheduled timeout')
  }
  
  console.log('✅ SMA Octopus system stopped')
  process.exit(0)
}

// Handle various termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'))   // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')) // Termination request
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'))   // Terminal closed

// State tracking
let currentChargingState = false
let chargingStartTime = null
let chargingStartSOC = null
let batteryCapacity = null
let chargingStartNotificationSent = false
const stateFile = path.join(__dirname, 'charging-state.json')

// Load previous state
function loadState() {
  debug('Loading previous state from file', stateFile)
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      currentChargingState = state.charging || false
      chargingStartTime = state.startTime ? new Date(state.startTime) : null
      chargingStartSOC = state.startSOC || null
      batteryCapacity = state.batteryCapacity || null
      chargingStartNotificationSent = state.chargingStartNotificationSent || false
      debug('Successfully loaded state', { currentChargingState, chargingStartTime, chargingStartSOC, batteryCapacity, chargingStartNotificationSent })
      console.log('Loaded previous state:', { currentChargingState, chargingStartTime, chargingStartSOC, batteryCapacity, chargingStartNotificationSent })
    } else {
      debug('No previous state file found, using defaults')
    }
  } catch (error) {
    debug('Error loading state file', error)
    console.error('Error loading state:', error)
  }
}

// Save current state
function saveState() {
  debug('Saving current state to file')
  try {
    const state = {
      charging: currentChargingState,
      startTime: chargingStartTime?.toISOString(),
      startSOC: chargingStartSOC,
      batteryCapacity: batteryCapacity,
      chargingStartNotificationSent: chargingStartNotificationSent
    }
    debug('State to save', state)
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
    debug('State saved successfully')
  } catch (error) {
    debug('Error saving state to file', error)
    console.error('Error saving state:', error)
  }
}

async function setCharge (on, stateOfCharge, currentChargingStateFromInverter, currentCapacity = null, forecastData = {}) {
  debug('setCharge called', { on, stateOfCharge, currentChargingStateFromInverter, currentCapacity, forecastData })
  
  // Use inverter data for current charging state, fallback to cached state
  const actualCurrentChargingState = currentChargingStateFromInverter !== null ? currentChargingStateFromInverter : currentChargingState
  debug('Using charging state', { fromInverter: currentChargingStateFromInverter, cached: currentChargingState, actual: actualCurrentChargingState })
  
  if (on && !actualCurrentChargingState) {
    // Starting to charge
    debug('Starting battery charging process')
    try {
      const {stdout, stderr} = await exec('FORCE_CHARGE=on npx playwright test tests/simpleBatteryControl.test.js')
      console.log('Starting battery charging...', stdout, stderr)
      debug('Battery charging command executed', { stdout: stdout.length + ' chars', stderr: stderr.length + ' chars' })
    } catch (error) {
      debug('Error executing battery on script', error)
      console.error('Error starting battery charging:', error)
      
      // Send detailed error email
      await Email.sendErrorEmail('Battery On Script Error', error.message, {
        script: 'tests/simpleBatteryControl.test.js (FORCE_CHARGE=on)',
        operation: 'Starting battery charging',
        stdout: error.stdout || 'No stdout',
        stderr: error.stderr || 'No stderr',
        stackTrace: error.stack,
        systemInfo: {
          timestamp: new Date().toISOString(),
          stateOfCharge: stateOfCharge,
          currentConsumption: 'unknown',
          targetCharging: true
        },
        environment: {
          DEBUG: process.env.DEBUG,
          OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED
        }
      })
      
      // Don't update charging state if script failed
      return
    }
    
    // Update charging state with current inverter data
    currentChargingState = true
    chargingStartTime = new Date()
    chargingStartSOC = stateOfCharge
    // Store the capacity at charging start time for accurate calculations later
    if (batteryCapacity === null && currentCapacity !== null) {
      batteryCapacity = currentCapacity
      debug('Battery capacity stored at charging start', batteryCapacity)
    }
    debug('Updated charging state variables', { currentChargingState, chargingStartTime, chargingStartSOC, batteryCapacity })
    saveState()
    
    // Only send notification if we haven't already sent one for this charging session
    if (!chargingStartNotificationSent) {
      debug('Sending charging started email with forecast data')
      const startEmailData = {
        forecastedGeneration: forecastData.forecastedGeneration,
        adjustedTargetSOC: forecastData.adjustedTargetSOC,
        originalTargetSOC: forecastData.originalTargetSOC,
        forecastAdjustment: forecastData.forecastAdjustment,
        currentSOC: stateOfCharge,
        currentConsumption: forecastData.currentConsumption
      }
      await Email.sendChargingStartedEmail(startEmailData)
      chargingStartNotificationSent = true
      saveState()
    } else {
      debug('Charging start notification already sent for this session - skipping duplicate email')
      console.log('⚠️ Charging already in progress - no duplicate notification sent')
    }
    
  } else if (!on && actualCurrentChargingState) {
    // Stopping charge
    debug('Stopping battery charging process')
    try {
      const {stdout, stderr} = await exec('FORCE_CHARGE=off npx playwright test tests/simpleBatteryControl.test.js')
      console.log('Stopping battery charging...', stdout, stderr)
      debug('Battery stop command executed', { stdout: stdout.length + ' chars', stderr: stderr.length + ' chars' })
    } catch (error) {
      debug('Error executing battery off script', error)
      console.error('Error stopping battery charging:', error)
      
      // Send detailed error email
      await Email.sendErrorEmail('Battery Off Script Error', error.message, {
        script: 'tests/simpleBatteryControl.test.js (FORCE_CHARGE=off)',
        operation: 'Stopping battery charging',
        stdout: error.stdout || 'No stdout',
        stderr: error.stderr || 'No stderr',
        stackTrace: error.stack,
        systemInfo: {
          timestamp: new Date().toISOString(),
          stateOfCharge: stateOfCharge,
          chargingStartTime: chargingStartTime?.toISOString() || 'unknown',
          chargingStartSOC: chargingStartSOC || 'unknown',
          targetCharging: false
        },
        environment: {
          DEBUG: process.env.DEBUG,
          OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED
        }
      })
      
      // Don't update charging state or send emails if script failed
      return
    }
    
    // Calculate kWh charged using actual battery capacity if available
    let kWhCharged = null
    let socIncrease = null
    let estimatedCost = null
    
    if (chargingStartSOC !== null && stateOfCharge !== null && !isNaN(chargingStartSOC) && !isNaN(stateOfCharge)) {
      debug('Calculating kWh charged', { chargingStartSOC, currentSOC: stateOfCharge })
      
      // Use capacity from inverter data if available, otherwise get from cache/API
      const actualCapacity = batteryCapacity || await getBatteryCapacity()
      socIncrease = stateOfCharge - chargingStartSOC
      debug('SOC calculation', { socIncrease, actualCapacity })
      
      if (actualCapacity !== null && !isNaN(actualCapacity) && !isNaN(socIncrease)) {
        kWhCharged = (socIncrease / 100) * actualCapacity
        // Ensure kWhCharged is not NaN
        if (!isNaN(kWhCharged) && kWhCharged > 0) {
          // Calculate estimated cost using Octopus Go rate
          const octopusGoRate = parseFloat(process.env.OCTOPUS_GO_RATE) || 8.5
          estimatedCost = kWhCharged * (octopusGoRate / 100) // Convert pence to pounds
          
          console.log(`Calculated kWh charged: SOC increase ${socIncrease}% × ${actualCapacity}kWh = ${kWhCharged.toFixed(2)}kWh (est. £${estimatedCost.toFixed(2)})`)
          debug('kWh calculation completed', { kWhCharged, socIncrease, estimatedCost })
        } else {
          debug('kWh calculation resulted in NaN or zero', { socIncrease, actualCapacity })
          kWhCharged = null
        }
      } else {
        console.log(`SOC increased by ${socIncrease}% (kWh unknown - battery capacity not available or invalid)`)
        debug('kWh calculation skipped - capacity unknown or invalid', { actualCapacity, socIncrease })
      }
    } else {
      debug('kWh calculation skipped - SOC data missing or invalid', { chargingStartSOC, stateOfCharge })
    }
    
    currentChargingState = false
    chargingStartTime = null
    chargingStartSOC = null
    chargingStartNotificationSent = false
    debug('Reset charging state variables')
    saveState()
    
    debug('Sending charging stopped email with forecast data', { kWhCharged, socIncrease, estimatedCost })
    const stopEmailData = {
      forecastedGeneration: forecastData.forecastedGeneration,
      adjustedTargetSOC: forecastData.adjustedTargetSOC,
      originalTargetSOC: forecastData.originalTargetSOC,
      forecastAdjustment: forecastData.forecastAdjustment,
      batteryCapacity: batteryCapacity
    }
    await Email.sendChargingStoppedEmail(kWhCharged, socIncrease, estimatedCost, stopEmailData)
    
  } else if (on) {
    debug('Already charging - no action needed')
    console.log('Already charging - no action needed')
  } else {
    debug('Already not charging - no action needed')
    console.log('Already not charging - no action needed')
  }
}

// Get battery capacity (cached to avoid repeated calls) - fallback for legacy usage
async function getBatteryCapacity() {
  debug('getBatteryCapacity called (legacy fallback)', { cached: batteryCapacity !== null })
  if (batteryCapacity === null) {
    try {
      debug('Battery capacity not cached, fetching from Sunny Portal')
      const data = await SMA.getAllInverterData()
      batteryCapacity = data.capacity
      if (batteryCapacity !== null) {
        debug('Battery capacity successfully retrieved from Sunny Portal', batteryCapacity)
        saveState() // Save the capacity so we don't need to fetch it again
      }
    } catch (error) {
      debug('Error getting battery capacity', error)
      console.error('Error getting battery capacity:', error)
    }
  }
  return batteryCapacity
}

async function main () {
  // Acquire file lock to prevent concurrent executions
  acquireLock()
  
  debug('===== MAIN FUNCTION STARTED =====')
  debug('Environment variables loaded', {
    DEBUG: process.env.DEBUG,
    OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED,
    EMAIL_ENABLED: process.env.EMAIL_ENABLED,
    FORCE_OCTOPUS_GO_WINDOW
  })
  
  if (FORCE_OCTOPUS_GO_WINDOW) {
    console.log('🔧 FORCE WINDOW MODE: Simulating Octopus Go time window')
  }
  console.log('Running battery management check at', new Date().toLocaleString())
  
  debug('Getting all inverter data in single session')
  const inverterData = await SMA.getAllInverterData()
  debug('All inverter data retrieved', inverterData)
  
  const { stateOfCharge, consumption: currentConsumption, capacity: currentCapacity, isCharging: currentChargingState, forceChargingWindows, forecastedGeneration } = inverterData
  
  debug('Extracted data components', {
    stateOfCharge,
    currentConsumption,
    currentCapacity,
    currentChargingState,
    forceChargingWindows,
    forecastedGeneration
  })
  
  debug('Charging state from combined data', { 
    currentChargingState, 
    forceChargingWindows
  })
  
  // Update cached battery capacity if we got it
  if (currentCapacity !== null && batteryCapacity !== currentCapacity) {
    batteryCapacity = currentCapacity
    debug('Updated cached battery capacity', batteryCapacity)
    saveState()
  }
  
  // Forecast data already extracted from getAllInverterData() above
  debug('Using forecasted generation from combined data', { forecastedGeneration })
  
  debug('Calling Octopus shouldCharge logic with forecast data', { 
    stateOfCharge, 
    currentConsumption, 
    currentChargingState, 
    FORCE_OCTOPUS_GO_WINDOW, 
    forecastedGeneration 
  })
  const chargeDecision = await Octopus.shouldCharge(stateOfCharge, currentConsumption, currentChargingState, FORCE_OCTOPUS_GO_WINDOW, forecastedGeneration)
  debug('shouldCharge decision made', chargeDecision)

  const { shouldCharge, forecastData } = chargeDecision
  
  // Enhanced formatted output with icons
  console.log('\n🔋 BATTERY MANAGEMENT STATUS')
  console.log('═'.repeat(50))
  
  // Battery status with icon based on SOC level
  let batteryIcon = '🔴' // Low battery
  if (stateOfCharge >= 80) batteryIcon = '🟢' // High battery
  else if (stateOfCharge >= 50) batteryIcon = '🟡' // Medium battery
  else if (stateOfCharge >= 20) batteryIcon = '🟠' // Low-medium battery
  
  console.log(`${batteryIcon} Battery SOC: ${stateOfCharge}%`)
  
  if (currentCapacity) {
    console.log(`📦 Battery Capacity: ${currentCapacity} kWh`)
  }
  
  // Power consumption with icon
  const consumptionIcon = currentConsumption > 2000 ? '⚡' : currentConsumption > 1000 ? '💡' : '🏠'
  console.log(`${consumptionIcon} Current Consumption: ${currentConsumption !== null ? currentConsumption + ' W' : 'N/A'}`)
  
  // PV Generation status
  if (inverterData.pvGeneration !== null) {
    const pvIcon = inverterData.pvGeneration > 1000 ? '☀️' : inverterData.pvGeneration > 0 ? '🌤️' : '🌙'
    console.log(`${pvIcon} PV Generation: ${inverterData.pvGeneration} W`)
  }
  
  // Charging status with appropriate icon - show force charging windows info
  const chargingIcon = currentChargingState ? '🔌' : '🔋'
  const chargingText = currentChargingState ? 'YES' : 'NO'
  
  if (forceChargingWindows !== null && forceChargingWindows !== undefined) {
    console.log(`${chargingIcon} Currently Charging: ${chargingText} (${forceChargingWindows} time windows configured)`)
  } else {
    console.log(`${chargingIcon} Currently Charging: ${chargingText}`)
  }
  
  // Forecast information with weather-appropriate icon
  const forecastIcon = forecastedGeneration !== null ? (forecastedGeneration > 5 ? '☀️' : forecastedGeneration > 1 ? '⛅' : '☁️') : '❓'
  console.log(`${forecastIcon} Solar Forecast: ${forecastedGeneration !== null ? forecastedGeneration.toFixed(1) + ' kWh' : 'N/A'}`)
  
  // Enhanced monthly targets display with forecast adjustment calculation
  if (forecastData) {
    const currentMonth = new Date().toLocaleString('default', { month: 'long' })
    console.log(`📅 ${currentMonth} Targets:`)
    
    if (forecastData.morningTarget && forecastData.eveningTarget) {
      console.log(`🌅 Morning Target: ${forecastData.morningTarget}% (daily minimum, no forecast adjustment)`)
      console.log(`🌙 Evening Target: ${forecastData.eveningTarget}% (overnight needs)`)
      
      // Calculate evening adjustment for display even if outside charging window
      if (forecastedGeneration !== null && forecastedGeneration > 0) {
        const assumedBatteryCapacity = 31.2 // kWh - should match octopus.js
        const forecastAdjustment = (forecastedGeneration / assumedBatteryCapacity) * 100
        const eveningTargetAdjusted = Math.max(forecastData.morningTarget || 30, forecastData.eveningTarget - forecastAdjustment)
        const finalTarget = Math.max(forecastData.morningTarget || 30, eveningTargetAdjusted)
        
        if (eveningTargetAdjusted !== forecastData.eveningTarget) {
          console.log(`🌙 Evening Adjusted: ${eveningTargetAdjusted.toFixed(1)}% (reduced by ${forecastAdjustment.toFixed(1)}% due to ${forecastedGeneration}kWh forecast)`)
        }
        
        console.log(`🎯 Final Target: ${finalTarget.toFixed(1)}% (higher of morning ${forecastData.morningTarget}% and evening ${eveningTargetAdjusted.toFixed(1)}%)`)
      } else {
        // No forecast data
        console.log(`🎯 Final Target: ${forecastData.eveningTarget}% (higher of morning ${forecastData.morningTarget}% and evening ${forecastData.eveningTarget}%)`)
      }
    } else {
      // Fallback for backward compatibility
      if (forecastData.adjustedTargetSOC !== forecastData.originalTargetSOC) {
        console.log(`🎯 Target SOC: ${forecastData.originalTargetSOC}% → ${forecastData.adjustedTargetSOC.toFixed(1)}% (forecast adjusted)`)
      } else {
        console.log(`🎯 Target SOC: ${forecastData.originalTargetSOC}%`)
      }
    }
  }
  
  // Time window information
  if (process.env.OCTOPUS_GO_ENABLED === 'true') {
    const windowIcon = FORCE_OCTOPUS_GO_WINDOW ? '🔧' : '⏰'
    let windowText
    if (FORCE_OCTOPUS_GO_WINDOW) {
      windowText = 'FORCED WINDOW MODE'
    } else {
      const inWindow = Octopus.isWithinOctopusGoWindow(FORCE_OCTOPUS_GO_WINDOW)
      windowText = inWindow ? 'Normal operation' : 'High rate'
    }
    console.log(`${windowIcon} Octopus Go: ${windowText}`)
  }
  
  // Final decision with prominent icon
  const decisionIcon = shouldCharge ? '🟢' : '🔴'
  const decisionText = shouldCharge ? 'START CHARGING' : 'STOP/CONTINUE NO CHARGING'
  
  // Generate BECAUSE explanation
  let becauseText = ''
  if (process.env.OCTOPUS_GO_ENABLED === 'true') {
    const inWindow = Octopus.isWithinOctopusGoWindow(FORCE_OCTOPUS_GO_WINDOW)
    if (!inWindow) {
      becauseText = 'BECAUSE outside cheap rate window (high rate period)'
    } else if (shouldCharge) {
      const targetSOC = forecastData?.adjustedTargetSOC || 30
      becauseText = `BECAUSE SOC ${stateOfCharge}% is below target ${targetSOC.toFixed(1)}% and in cheap rate window`
    } else {
      const targetSOC = forecastData?.adjustedTargetSOC || 30
      becauseText = `BECAUSE SOC ${stateOfCharge}% is at/above target ${targetSOC.toFixed(1)}%`
    }
  } else {
    becauseText = shouldCharge ? 'BECAUSE price is low and SOC is low' : 'BECAUSE price is high or SOC is sufficient'
  }
  
  console.log(`\n${decisionIcon} DECISION: ${decisionText}`)
  console.log(`${becauseText}`)
  
  // SAFEGUARD: Prevent battery from being stuck in force charge mode
  if (currentChargingState === true && !shouldCharge) {
    console.log('⚠️  SAFEGUARD ALERT: Battery is in force charge mode but logic says not to charge!')
    console.log('🛡️  This could leave the battery stuck in force charge - ensuring it gets turned off')
    
    // Send alert email about the safeguard action
    try {
      await Email.sendErrorEmail('Battery Force Charge Safeguard Activated', 
        'Battery was detected in force charge mode but charging logic determined it should not be charging. Safeguard activated to prevent battery being stuck in force charge.', 
        {
          currentState: 'Force charging (parameter = 1)',
          expectedState: 'Not charging (parameter = 91)',
          action: 'Forcing battery off to prevent being stuck in force charge',
          stateOfCharge: stateOfCharge + '%',
          safeguardReason: shouldCharge ? 'Logic says should charge' : 'Logic says should NOT charge',
          systemInfo: {
            timestamp: new Date().toISOString(),
            OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED,
            forecastedGeneration: forecastData?.forecastedGeneration || 'N/A'
          }
        }
      )
    } catch (emailError) {
      debug('Failed to send safeguard alert email', emailError)
    }
  }
  
  console.log('═'.repeat(50))

  debug('Calling setCharge with decision and forecast data', { shouldCharge, stateOfCharge, forecastData })
  await setCharge(shouldCharge, stateOfCharge, currentChargingState, currentCapacity, forecastData)
  debug('===== MAIN FUNCTION COMPLETED =====')
}

// Load previous state on startup
debug('System starting up')
debug('Debug mode enabled:', DEBUG)
loadState()

// Function to schedule next execution
function scheduleNextRun() {
  if (isShuttingDown) return
  
  const nextRunTime = new Date(Date.now() + CHECK_INTERVAL_MS)
  debug('Scheduling next run', { 
    intervalMinutes: CHECK_INTERVAL_MINUTES,
    nextRunTime: nextRunTime.toLocaleString() 
  })
  
  currentTimeout = setTimeout(() => {
    if (!isShuttingDown) {
      runMainLoop()
    }
  }, CHECK_INTERVAL_MS)
}

// Main execution loop
async function runMainLoop() {
  if (isShuttingDown) return
  
  try {
    debug('Starting main execution')
    await main()
    debug('Main execution completed successfully')
    
    if (!RUN_ONCE && !isShuttingDown) {
      console.log(`⏰ Next check scheduled in ${CHECK_INTERVAL_MINUTES} minutes`)
      scheduleNextRun()
    }
    
  } catch (error) {
    debug('Main function error', error)
    console.error('❌ Error in main execution:', error.message)
    
    // Send error email for main function failures
    try {
      await Email.sendErrorEmail('System Error', error.message, {
        script: 'server.js',
        operation: 'Main execution loop',
        stackTrace: error.stack,
        systemInfo: {
          timestamp: new Date().toISOString(),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          uptime: process.uptime()
        },
        environment: {
          DEBUG: process.env.DEBUG,
          OCTOPUS_GO_ENABLED: process.env.OCTOPUS_GO_ENABLED,
          OCTOPUS_GO_START_TIME: process.env.OCTOPUS_GO_START_TIME,
          OCTOPUS_GO_END_TIME: process.env.OCTOPUS_GO_END_TIME,
          OCTOPUS_GO_TARGET_SOC: process.env.OCTOPUS_GO_TARGET_SOC,
          EMAIL_ENABLED: process.env.EMAIL_ENABLED
        }
      })
    } catch (emailError) {
      console.error('Failed to send error email:', emailError)
    }
    
    if (!RUN_ONCE && !isShuttingDown) {
      console.log(`⏰ Retrying in ${CHECK_INTERVAL_MINUTES} minutes despite error`)
      scheduleNextRun()
    }
  }
}

// Start the system
console.log('🔋 SMA Octopus Battery Management System')
console.log(`📊 Mode: ${RUN_ONCE ? 'Single run' : 'Continuous operation'}`)
if (!RUN_ONCE) {
  console.log(`⏰ Check interval: ${CHECK_INTERVAL_MINUTES} minutes`)
  console.log(`🛑 Press Ctrl+C to stop`)
}

debug('Starting initial execution')
runMainLoop()