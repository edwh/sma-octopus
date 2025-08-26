# Introduction

Electricity tariffs like Octopus Go and battery storage open up the opportunity to store energy when it's cheap.

This tool controls an SMA Sunny Island inverter based on time-based tariffs (Octopus Go) or dynamic pricing (Octopus
Agile). It uses Octopus APIs and Playwright scripts to interact directly with the SMA inverter's web interface.

**Current Status:**

- ✅ **Octopus Go**: Complete time-based charging system with solar forecast integration
- ✅ **Sunny Portal Integration**: Automated solar generation forecasting
- ⚠️ **Octopus Agile**: Legacy support - work in progress for full integration

This is my use-case:

* I have solar PV, SMA Sunny Island inverters and an SMA Home Manager.
* I am on Octopus Go and an EV that is controlled by Octopus and will charge at ~4kW.
* When Octopus triggers car charging during the window, my SMA system will use capacity from the battery if available.
  Otherwise it'll pull it in from the grid at the low rate.
* If the car isn't charging, then I want to top up the battery to a certain level during the cheap rate window. This
  gives me the capacity I expect to need for the morning load before the PV kicks in.
* The system now automatically pulls solar generation forecasts from Sunny Portal to optimize charging, reducing
  unnecessary battery charging when solar generation is expected to meet daily energy needs.

# Installation

`npm install`
`npx playwright install-deps`
`npx playwright install`

# Configuration

Copy `.env.example` to `.env` and configure the following variables:

## SMA Inverter Configuration

* `inverterIP` - IP address of the SMA inverter
* `installerPassword` - Installer password for the inverter web UI

## Sunny Portal Configuration (Solar Forecasting)

* `SUNNY_PORTAL_USERNAME` - Your Sunny Portal email address
* `SUNNY_PORTAL_PASSWORD` - Your Sunny Portal password
* `SUNNY_PORTAL_URL` - Sunny Portal URL (default: https://www.sunnyportal.com/)

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
* `npm run forecast` - Show current solar forecast and charging decision (see below)
* `npm run batteryOn` - Manually turn battery charging on
* `npm run batteryOff` - Manually turn battery charging off
* `npm run getAllData` - Get all inverter data (SOC, consumption, capacity, charging status) in one session
* `npm test` - Run all Playwright tests

### Solar Forecast Display

Use `npm run forecast` to see a comprehensive overview of:

* **Current Status**: Battery SOC, consumption, charging state
* **Solar Forecast**: Expected generation for remainder of day from Sunny Portal
* **Charging Decision**: How the forecast affects target SOC and charging decisions  
* **Cost Savings**: Estimated savings from forecast-optimized charging
* **Octopus Go Window**: Current time vs cheap rate periods

Example output:
```
🔋 SMA Octopus Charging Forecast
================================

=== CURRENT STATUS ===
🔋 Battery SOC: 32%
⚡ Current consumption: N/A W
🔌 Currently charging: No

=== SOLAR FORECAST ===
☀️ Expected generation today: 3 kWh
📈 Forecast impact: Reduces target SOC by 9.6%

=== CHARGING DECISION ===
🎯 Original target SOC: 30%
🎯 Adjusted target SOC: 20.4%
⚡ Should charge: ❌ NO
💰 Estimated savings from forecast: 3.00 kWh (£0.26)

=== OCTOPUS GO STATUS ===
⏰ Current time: 14:30
🕐 Octopus Go window: 00:30 - 05:30
🪟 Currently in window: ❌ NO
```

# Algorithm

The system supports two charging algorithms:

## Octopus Go Mode (Recommended)

When `OCTOPUS_GO_ENABLED=true`, the system uses intelligent time-based charging optimized for Octopus Go tariffs with solar forecast integration:

1. **Solar Forecast Integration**: 
    - Automatically retrieves solar generation forecasts from Sunny Portal
    - Adjusts target SOC based on expected solar generation for remainder of day
    - Reduces unnecessary charging when solar will provide sufficient energy
    - Calculates cost savings from forecast-optimized decisions

2. **Time Window Check**: Only charges during the configured cheap rate window (default 00:30-05:30)

3. **Dynamic SOC Target**: 
    - Base target SOC configurable (default 30%)
    - Automatically reduced based on solar forecast: `Adjusted Target = Original Target - (Forecast kWh / Battery Capacity kWh) × 100%`
    - Prevents overcharging when solar generation will meet daily needs

4. **Consumption-Aware Logic**:
    - Won't **start** charging if current consumption > `CONSUMPTION_START_THRESHOLD` (3kW)
    - Will **stop** charging if current consumption > `CONSUMPTION_STOP_THRESHOLD` (6kW)
    - This prevents overloading your electrical supply when charging begins

5. **State Tracking**: Remembers charging state between runs and sends detailed email notifications

6. **Accurate kWh Calculation**: Retrieves actual battery capacity from SMA inverter for precise energy calculations

7. **Enhanced Notifications**: Email alerts include:
    - Solar forecast information and adjusted targets
    - Estimated cost savings from forecast optimization
    - Detailed decision logic explanations

## Agile Mode (Legacy)

When `OCTOPUS_GO_ENABLED=false`, falls back to the original Octopus Agile price-based algorithm:

1. **Price Analysis**: Fetches current Octopus Agile prices and calculates percentiles
2. **Threshold-Based Charging**: Charges when prices are in the cheap percentile and battery SOC is low
3. **Dynamic Pricing**: Adapts to varying electricity prices throughout the day

## Key Features

✅ **Solar Forecast Integration**: Automatically fetches solar generation forecasts from Sunny Portal  
✅ **Smart Target Adjustment**: Dynamically reduces charging target based on expected solar generation  
✅ **Cost Optimization**: Prevents unnecessary charging when solar will provide sufficient energy  
✅ **Robust Error Handling**: Gracefully handles forecast failures with email notifications  
✅ **Detailed Notifications**: Email alerts with forecast data, decision logic, and cost savings  
✅ **Real-time Monitoring**: `npm run forecast` command for instant status overview  
✅ **Production Ready**: Comprehensive logging, state management, and fail-safes  

## Example Scenarios

**Scenario 1: High Solar Forecast**
- SOC: 25%, Original Target: 30%, Forecast: 10 kWh  
- Adjusted Target: 0% (reduced by ~32%)
- Decision: **No charging** (solar will provide sufficient energy)
- Savings: ~£0.85 avoided charging costs

**Scenario 2: Moderate Solar Forecast**  
- SOC: 15%, Original Target: 30%, Forecast: 3 kWh
- Adjusted Target: 20.4% (reduced by 9.6%)  
- Decision: **Charge to 20.4%** (optimized for expected solar)
- Savings: ~£0.26 from reduced charging

**Scenario 3: No Forecast Available**
- SOC: 25%, Target: 30%, Forecast: 0 kWh (fallback)
- Decision: **Charge to 30%** (standard behavior maintained)
- Reliability: System continues to work even when Sunny Portal is unavailable

## Future Enhancements

* Weather-based forecast refinement using external APIs
* Machine learning for consumption pattern recognition  
* Multi-battery system support
* Integration with other solar forecast providers