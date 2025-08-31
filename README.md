# Introduction

Electricity tariffs like Octopus Go and battery storage open up the opportunity to store energy when it's cheap.

This tool controls an SMA Sunny Island inverter based on time-based tariffs (Octopus Go) or dynamic pricing (Octopus
Agile). It uses Octopus APIs and Playwright scripts to interact with Sunny Portal for both data collection and charging control.

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

## Sunny Portal Configuration

* `SUNNY_PORTAL_USERNAME` - Your Sunny Portal email address
* `SUNNY_PORTAL_PASSWORD` - Your Sunny Portal password
* `SUNNY_PORTAL_URL` - Sunny Portal URL (default: https://www.sunnyportal.com/)
* `SUNNY_PORTAL_FORECAST_MULTIPLIER` - Forecast adjustment percentage (default: 100) - use to calibrate forecast accuracy:
  - `100` = Use forecast as-is
  - `80` = Reduce forecast by 20% (conservative)
  - `120` = Increase forecast by 20% (optimistic)

## Octopus Go Configuration

* `OCTOPUS_GO_ENABLED` - Enable Octopus Go time-based charging (true/false)
* `OCTOPUS_GO_START_TIME` - Cheap rate start time in GMT/UTC (default: 00:30)
* `OCTOPUS_GO_END_TIME` - Cheap rate end time in GMT/UTC (default: 05:30)
* `OCTOPUS_GO_RATE` - Cheap rate price in pence (default: 8.5)

**Important**: Octopus Go times are always specified in GMT (UTC), regardless of local time zone or British Summer Time (BST). The system automatically handles the conversion to local time for comparison.

## Battery Configuration

The system uses monthly target SOC values to account for seasonal variations in energy usage and solar generation:

* `OCTOPUS_GO_MORNING_TARGET_SOC` - Monthly morning target SOC (CSV format) - ensures minimum charge for daily use, excludes forecast adjustments
* `OCTOPUS_GO_EVENING_TARGET_SOC` - Monthly evening target SOC (CSV format) - ensures charge for overnight/next morning, includes forecast adjustments

**Format**: 12 comma-separated values for Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec

**Default values**:
- Morning: `45,45,45,30,30,30,30,30,30,45,45,45` (Higher in winter months Oct-Mar)
- Evening: `60,60,60,55,55,55,55,55,55,60,60,60` (Higher in winter months Oct-Mar)

**Charging Logic**:
1. **Morning Target**: Fixed value per month, no solar forecast adjustment
2. **Evening Target**: Reduced by expected solar generation (forecasted kWh ÷ battery capacity)
3. **Final Target**: Higher of morning target and adjusted evening target
4. **Seasonal Adjustment**: Winter months (Oct-Mar) have higher targets for increased heating/lighting demand and reduced solar generation

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

**Technical Details:**

The system extracts hourly forecast data from Sunny Portal using advanced DOM parsing:

1. **Forecast Chart Parsing**: Identifies `.forecastColumn[data-hasqtip]` elements representing hourly forecast bars
2. **Tooltip Extraction**: Hovers over each column to trigger tooltips containing detailed hourly data
3. **Time Filtering**: Compares tooltip time ranges (e.g., "9:00 AM - 10:00 AM") with current local time from Sunny Portal
4. **Net Energy Calculation**: Extracts "Difference" values from tooltips (PV generation - consumption) for accurate net energy available for battery
5. **Future Hours Only**: Only includes hours that haven't started yet to provide remaining daily forecast
6. **Forecast Summation**: Sums all future hourly "Difference" values to get total net energy expected for rest of day

Example output:
```
🔋 SMA Octopus Charging Forecast
================================

=== CURRENT STATUS ===
🔋 Battery SOC: 32%
⚡ Current consumption: N/A W
🔌 Currently charging: No

=== SOLAR CHARGING ===
🔋 Expected net charging today: 13.1 kWh (42.0% of 31.2 kWh battery)

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
    - Automatically retrieves detailed hourly solar generation forecasts from Sunny Portal
    - Extracts "Difference" values (PV generation - consumption) for each future hour to determine net energy available for battery charging
    - Only includes future hours (after current time) in forecast calculations to avoid counting past generation
    - Adjusts target SOC based on expected solar generation for remainder of day
    - Reduces unnecessary charging when solar will provide sufficient energy
    - Calculates cost savings from forecast-optimized decisions

2. **Time Window Check**: Only charges during the configured cheap rate window (default 00:30-05:30)

3. **Monthly Dynamic SOC Targets**: 
    - **Morning Target**: Monthly values (default 30-45% seasonal) - minimum charge for daily use
    - **Evening Target**: Monthly values (default 55-60% seasonal) - charge for overnight/next morning
    - **Forecast Adjustment**: Evening target automatically reduced based on solar forecast: `Adjusted Evening Target = Evening Target - (Forecast kWh / Battery Capacity kWh) × 100%`
    - **Final Target**: Uses higher of morning target and adjusted evening target
    - **Seasonal Variation**: Higher targets in winter months (Oct-Mar) for increased demand and reduced solar

4. **Consumption-Aware Logic**:
    - Won't **start** charging if current consumption > `CONSUMPTION_START_THRESHOLD` (3kW)
    - Will **stop** charging if current consumption > `CONSUMPTION_STOP_THRESHOLD` (6kW)
    - This prevents overloading your electrical supply when charging begins

5. **State Tracking**: Remembers charging state between runs and sends detailed email notifications

6. **Accurate kWh Calculation**: Retrieves actual battery capacity from Sunny Portal for precise energy calculations

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