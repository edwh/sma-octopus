# Introduction

Agile electricity tariffs and battery storage open up the opportunity to store energy when it's cheap.

This is a proof of concept tool which controls an SMA Sunny Island inverter based on Octopus Agile prices. It uses a
combination of Octopus APIs, SMA APIs, and Playwright scripts to control the inverter.

# Installation

`npm install`
`npx playwright install-deps`
`npx playwright install`

# Configuration

You'll need to set the following environment variables.

* `inverterIP`  This is the IP address of the inverter.
* `installerPassword` This is the password on the inverter device (not Sunny Portal), as used on the web UI.

At present we don't use the SMA APIs. If/when we do you'll need to set these variables too. These APIs are chargeable
and only available to installers, so you'll need to be one or know one.

* `clientId` This is the SMA API client id. SMA APIs are only available to SMA installers, so you'll need to work with
  one to get access.
* `clientSecret` This is the SMA API secret.
* `ownerEmail` This is the email address of the owner. When the API is first accessed, the owner will receive an email
  to confirm access.

# Execution

`node server.js`

# Algorithm

So far there is a very basic threshold-based algorithm for deciding whether to charge.
There is scope for using SMA's prediction APIs to make this better, and there will be standard
optimisation techniques I've not researched yet.