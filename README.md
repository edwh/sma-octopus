# Introduction

Agile electricity tariffs and battery storage open up the opportunity to store energy when it's cheap.

This is a proof of concept tool which controls an SMA Sunny Island inverter based on Octopus Agile prices. It uses a
combination of Octopus APIs, SMA APIs, and Playwright scripts to control the inverter.

# Configuration

You'll need to set the following environment variables.

* `clientId` This is the SMA API client id. SMA APIs are only available to SMA installers, so you'll need to work with
  one to get access.
* `clientSecret` This is the SMA API secret.
* `ownerEmail` This is the email address of the owner. When the API is first accessed, the owner will receive an email
  to confirm access.
* `inverterIP`  This is the IP address of the inverter.
* `installerPassword` This is the password on the inverter device (not Sunny Portal), as used on the web UI.

