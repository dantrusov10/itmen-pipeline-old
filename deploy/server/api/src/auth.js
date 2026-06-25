"use strict";

const PB_URL = process.env.PB_URL || "http://127.0.0.1:8095";

async function pbUserFetch(path, token, opts = {}) {
  const auth = token ? (token.startsWith("Bearer ") ? token : `Bearer ${token}`) : "";
  const res = await fetch(`${PB_URL}${path}`, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body == null ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!res.ok) {
    const err = new Error(data.message || res.statusText || "Auth error");
    err.status = res.status;
    throw err;
  }
  return data;
}

async function loginUser(email, password) {
  const data = await pbUserFetch("/api/collections/pipeline_users/auth-with-password", null, {
    method: "POST",
    body: { identity: email, password },
  });
  return {
    token: data.token,
    user: normalizeUser(data.record),
  };
}

async function refreshUser(token) {
  const data = await pbUserFetch("/api/collections/pipeline_users/auth-refresh", token, {
    method: "POST",
  });
  return {
    token: data.token,
    user: normalizeUser(data.record),
  };
}

function normalizeUser(record) {
  if (!record) return null;
  return {
    id: record.id,
    email: record.email,
    role: record.role || "manager",
    managerName: record.manager_name || "",
    displayName: record.display_name || record.manager_name || record.email,
  };
}

function parseBearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : (h || null);
}

function requireAuth(loadUser = true) {
  return async (req, res, next) => {
    const token = parseBearer(req);
    if (!token) return res.status(401).json({ error: "Требуется вход в систему" });
    try {
      if (loadUser) {
        const { user } = await refreshUser(token);
        req.user = user;
        req.userToken = token;
      } else {
        req.userToken = token;
      }
      next();
    } catch (e) {
      res.status(401).json({ error: "Сессия истекла — войдите снова" });
    }
  };
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Доступно только администратору" });
  }
  next();
}

function canEditDeal(user, deal) {
  if (!user || !deal) return false;
  if (user.role === "admin") return true;
  return Boolean(user.managerName) && deal.owner === user.managerName;
}

function canDeleteDeal(user, deal) {
  return canEditDeal(user, deal);
}

module.exports = {
  loginUser,
  refreshUser,
  normalizeUser,
  requireAuth,
  requireAdmin,
  canEditDeal,
  canDeleteDeal,
};
