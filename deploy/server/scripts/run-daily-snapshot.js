#!/usr/bin/env node
"use strict";
const path = require("path");
const fs = require("fs");

const envPath = "/opt/itmen-pipeline/.env";
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { takeDailySnapshot } = require(path.join(__dirname, "..", "api", "src", "snapshot"));

takeDailySnapshot("cron")
  .then(r => {
    console.log(JSON.stringify(r));
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
