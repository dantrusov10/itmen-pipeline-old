"use strict";

const PB_URL = process.env.PB_URL || "http://127.0.0.1:8095";

let token = null;
let authPromise = null;

function loadEnv() {
  if (process.env.PB_ADMIN_EMAIL && process.env.PB_ADMIN_PASSWORD) return;
  try {
    const fs = require("fs");
    const path = "/opt/itmen-pipeline/.env";
    if (!fs.existsSync(path)) return;
    for (const line of fs.readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [k, v] = trimmed.split("=", 2);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (_) {}
}

async function ensureAuth() {
  if (token) return token;
  if (!authPromise) {
    authPromise = (async () => {
      loadEnv();
      const email = process.env.PB_ADMIN_EMAIL;
      const password = process.env.PB_ADMIN_PASSWORD;
      if (!email || !password) throw new Error("PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set");
      const res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "PocketBase auth failed");
      token = data.token;
      return token;
    })();
  }
  return authPromise;
}

async function pbFetch(path, { method = "GET", body = null, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = await ensureAuth();
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {}
  if (!res.ok) {
    const err = new Error(data.message || res.statusText || "PocketBase error");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listAll(collection, opts = {}) {
  const items = [];
  let page = 1;
  const perPage = opts.perPage || 500;
  while (true) {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    if (opts.filter) params.set("filter", opts.filter);
    if (opts.sort) params.set("sort", opts.sort);
    const data = await pbFetch(`/api/collections/${collection}/records?${params}`);
    items.push(...(data.items || []));
    if (page >= (data.totalPages || 1)) break;
    page += 1;
  }
  return items;
}

async function findOne(collection, filter) {
  try {
    const params = new URLSearchParams({ filter, perPage: "1" });
    const data = await pbFetch(`/api/collections/${collection}/records?${params}`);
    return (data.items || [])[0] || null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function createRecord(collection, body) {
  return pbFetch(`/api/collections/${collection}/records`, { method: "POST", body });
}

async function updateRecord(collection, id, body) {
  return pbFetch(`/api/collections/${collection}/records/${id}`, { method: "PATCH", body });
}

async function deleteRecord(collection, id) {
  return pbFetch(`/api/collections/${collection}/records/${id}`, { method: "DELETE" });
}

async function deleteByFilter(collection, filter) {
  const rows = await listAll(collection, { filter, perPage: 200 });
  for (const row of rows) {
    await deleteRecord(collection, row.id);
  }
  return rows.length;
}

module.exports = {
  ensureAuth,
  listAll,
  findOne,
  createRecord,
  updateRecord,
  deleteRecord,
  deleteByFilter,
};
