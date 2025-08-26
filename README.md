# Introduction

Electricity tariffs like Octopus Go and battery storage open up the opportunity to store energy when it's cheap.

This tool controls an SMA Sunny Island inverter based on time-based tariffs (Octopus Go) or dynamic pricing (Octopus
Agile). It uses Octopus APIs and Playwright scripts to interact directly with the SMA inverter's web interface.

**Current Status:**

- ✅ **Octopus Go**: Working time-based charging system
- ⚠️ **Octopus Agile**: Legacy support - work in progress for full integration

This is my use-case:

* I have solar PV, SMA Sunny Island inverters and an SMA Home Manager.
* I am on Octopus Go and an EV that is controlled by Octopus and will charge at ~4kW.
* When Octopus triggers car charging during the window, my SMA system will use capacity from the battery if available.
  Otherwise it'll pull it in from the grid at the low rate.
* If the car isn't charging, then I want to top up the battery to a certain level during the cheap rate window. This
  gives me the capacity I expect to need for the morning load before the PV kicks in.
  In future I might pull in the predicted generation from Sunny Portal so that I can expect get to the end of the day
  with a certain SOC.

# Installation

`npm install`
`npx playwright install-deps`
`npx playwright install`

# Configuration

Copy `.env.example` to `.env` and configure the following variables:

## SMA Inverter Configuration

* `inverterIP` - IP address of the SMA inverter
* `installerPassword` - Installer password for the inverter web UI

## Octopus Go Configuration

* `OCTOPUS_GO_ENABLED` - Enable Octopus Go time-based charging (true/false)
* `OCTOPUS_GO_START_TIME` - Cheap rate start time (default: 00:30)
* `OCTOPUS_GO_END_TIME` - Cheap rate end time (default: 05:30)
* `OCTOPUS_GO_RATE` - Cheap rate price in pence (default: 8.5)

## Battery Configuration

* `OCTOPUS_GO_TARGET_SOC` - Target state of charge percentage - only charge if battery is below this (default: 40)

## Consumption Thresholds

* `CONSUMPTION_START_THRESHOLD` - Don't start charging if consumption exceeds this (watts, default: 3000)
* `CONSUMPTION_STOP_THRESHOLD` - Stop charging if consumption exceeds this (watts, default: 6000)

## Email Notifications

* `EMAIL_ENABLED` - Enable email notifications (true/false)
* `SMTP_HOST` - SMTP server hostname
* `SMTP_PORT` - SMTP server port
* `SMTP_USER` - SMTP username
* `SMTP_PASS` - SMTP password
* `EMAIL_FROM` - From email address
* `EMAIL_TO` - Recipient email address

## Debug Configuration

* `DEBUG` - Enable detailed debug logging (true/false, default: false)

When enabled, debug logging provides comprehensive information about:

* API calls and responses
* Time window calculations
* Consumption threshold checks
* Battery state changes
* Email notification attempts
* Error conditions and troubleshooting data

Each log entry includes timestamps and module prefixes (OCTOPUS, SMA, EMAIL) for easy filtering.

# Execution

```bash
npm start
# or
node server.js
```

## CLI Options

The main script supports several command-line options:

```bash
node server.js [options]
```

**Options:**

* `-f, --force-window` - Force the system to act as if it's within the Octopus Go time window (useful for testing)
* `-h, --help` - Show help message with all available options

**Examples:**

```bash
node server.js                    # Normal operation
node server.js --force-window     # Test charging logic outside normal hours
DEBUG=true node server.js         # Run with debug logging
DEBUG=true node server.js -f      # Debug mode with forced window
```

## Available Scripts

* `npm start` - Run the main charging control system
* `npm run batteryOn` - Manually turn battery charging on
* `npm run batteryOff` - Manually turn battery charging off
* `npm run getAllData` - Get all inverter data (SOC, consumption, capacity, charging status) in one session
* `npm test` - Run all Playwright tests

# Algorithm

The system supports two charging algorithms:

## Octopus Go Mode (Recommended)

When `OCTOPUS_GO_ENABLED=true`, the system uses time-based charging optimized for Octopus Go tariffs:

1. **Time Window Check**: Only charges during the configured cheap rate window (default 00:30-05:30)
2. **SOC Target Check**: Only charges if battery SOC is below the configured target (default 40%)
3. **Consumption-Aware Logic**:
    - Won't **start** charging if current consumption > `CONSUMPTION_START_THRESHOLD` (3kW)
    - Will **stop** charging if current consumption > `CONSUMPTION_STOP_THRESHOLD` (6kW)
    - This prevents overloading your electrical supply when charging begins
4. **State Tracking**: Remembers charging state between runs and sends email notifications
5. **Accurate kWh Calculation**: Retrieves actual battery capacity from SMA inverter for precise energy calculations

## Agile Mode (Legacy)

When `OCTOPUS_GO_ENABLED=false`, falls back to the original Octopus Agile price-based algorithm:

1. **Price Analysis**: Fetches current Octopus Agile prices and calculates percentiles
2. **Threshold-Based Charging**: Charges when prices are in the cheap percentile and battery SOC is low
3. **Dynamic Pricing**: Adapts to varying electricity prices throughout the day

## Future Enhancements

* Weather-based optimization using external APIs
* Machine learning for consumption pattern recognition
* Solar generation forecasting integration
* Multi-battery system support