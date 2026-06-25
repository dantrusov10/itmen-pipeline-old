#!/usr/bin/env node
const PocketBase = require("pocketbase/cjs");
const fs = require("fs");

const env = {};
for (const line of fs.readFileSync("/opt/itmen-pipeline/.env", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)/);
  if (m) env[m[1]] = m[2];
}

const pb = new PocketBase("http://127.0.0.1:8095");
pb.admins.authWithPassword(env.PB_ADMIN_EMAIL, env.PB_ADMIN_PASSWORD)
  .then(() => pb.collection("deals").getList(1, 1))
  .then((r) => console.log("deals", r.totalItems))
  .catch((e) => console.error("ERR", e.message, e?.response || e?.data || ""));
