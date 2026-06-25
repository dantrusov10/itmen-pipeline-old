/* Авторизация менеджеров / администратора (PocketBase backend) */
const AUTH_STORAGE_KEY = "itmen_pipeline_auth_v1";

window.ITMEN_AUTH = {
  user: null,
  token: null,
};

function escapeAuthHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function authRequired() {
  return window.ITMEN_API?.backend === "pocketbase";
}

function loadAuthFromStorage() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistAuth(session) {
  if (!session?.token) {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    window.ITMEN_AUTH.user = null;
    window.ITMEN_AUTH.token = null;
    return;
  }
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  window.ITMEN_AUTH.user = session.user;
  window.ITMEN_AUTH.token = session.token;
}

function authHeaders() {
  const token = window.ITMEN_AUTH?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isAdmin() {
  return window.ITMEN_AUTH?.user?.role === "admin";
}

function canEditDeal(deal) {
  const user = window.ITMEN_AUTH?.user;
  if (!user) return false;
  if (user.role === "admin") return true;
  return Boolean(user.managerName) && deal?.owner === user.managerName;
}

function canDeleteDeal(deal) {
  return canEditDeal(deal);
}

async function apiAuthLogin(email, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка входа");
  persistAuth({ token: data.token, user: data.user });
  return data;
}

async function apiAuthMe() {
  const res = await fetch("/api/auth/me", {
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Сессия истекла");
  persistAuth({ token: window.ITMEN_AUTH.token, user: data.user });
  return data.user;
}

function logoutAuth() {
  persistAuth(null);
  if (authRequired()) location.reload();
}

async function ensureAuthSession() {
  if (!authRequired()) return true;
  const cached = loadAuthFromStorage();
  if (cached?.token) {
    window.ITMEN_AUTH.token = cached.token;
    window.ITMEN_AUTH.user = cached.user;
    try {
      await apiAuthMe();
      return true;
    } catch (_) {
      persistAuth(null);
    }
  }
  return showLoginModal();
}

function renderAuthTopbar() {
  const topbar = document.querySelector(".topbar > div");
  if (!topbar || !authRequired()) return;
  let el = document.getElementById("auth-user-bar");
  if (!el) {
    el = document.createElement("div");
    el.id = "auth-user-bar";
    el.style.cssText = "margin-left:auto;display:flex;align-items:center;gap:.5rem;font-size:.85rem";
    topbar.appendChild(el);
  }
  const u = window.ITMEN_AUTH.user;
  if (!u) {
    el.innerHTML = `<button type="button" class="btn btn-sm" id="auth-login-btn">Войти</button>`;
    document.getElementById("auth-login-btn")?.addEventListener("click", () => showLoginModal());
    return;
  }
  const roleLabel = u.role === "admin" ? "админ" : "менеджер";
  el.innerHTML = `
    <span class="muted">${escapeAuthHtml(u.displayName || u.email)} · ${roleLabel}</span>
    <button type="button" class="btn btn-sm" id="auth-logout-btn">Выйти</button>`;
  document.getElementById("auth-logout-btn")?.addEventListener("click", logoutAuth);
}

function showLoginModal() {
  return new Promise(resolve => {
    let overlay = document.getElementById("auth-modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "auth-modal";
      overlay.className = "modal-overlay open";
      overlay.innerHTML = `
        <div class="modal" style="max-width:420px">
          <div class="modal-header"><h3>Вход в пайплайн</h3></div>
          <div class="modal-body">
            <p class="muted" style="font-size:.85rem;margin-bottom:1rem">
              Менеджеры видят все сделки, редактируют только свои. Дашборд доступен всем.
            </p>
            <div class="form-grid" style="grid-template-columns:1fr">
              <div><label>Email</label><input id="auth-email" type="email" autocomplete="username"></div>
              <div><label>Пароль</label><input id="auth-password" type="password" autocomplete="current-password"></div>
            </div>
            <p id="auth-error" class="muted" style="color:#b45309;font-size:.82rem;min-height:1.2em;margin-top:.5rem"></p>
            <div style="margin-top:1rem;display:flex;gap:.5rem;justify-content:flex-end">
              <button type="button" class="btn btn-primary" id="auth-submit">Войти</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    } else {
      overlay.classList.add("open");
    }

    const submit = async () => {
      const errEl = document.getElementById("auth-error");
      errEl.textContent = "";
      try {
        await apiAuthLogin(
          document.getElementById("auth-email").value.trim(),
          document.getElementById("auth-password").value,
        );
        overlay.classList.remove("open");
        renderAuthTopbar();
        resolve(true);
      } catch (e) {
        errEl.textContent = e.message || "Ошибка входа";
      }
    };

    document.getElementById("auth-submit").onclick = submit;
    document.getElementById("auth-password").onkeydown = e => {
      if (e.key === "Enter") submit();
    };
  });
}

function applyDealModalReadOnly(canEdit) {
  const modal = document.getElementById("deal-modal");
  if (!modal) return;
  modal.classList.toggle("deal-readonly", !canEdit);
  const saveBtn = modal.querySelector(".modal-header-actions .btn-primary");
  if (saveBtn) saveBtn.hidden = !canEdit;
  modal.querySelector(".deal-readonly-banner")?.remove();
  if (!canEdit) {
    const banner = document.createElement("div");
    banner.className = "deal-readonly-banner";
    banner.style.cssText = "background:#eff6ff;border-bottom:1px solid #bfdbfe;padding:.45rem 1rem;font-size:.82rem;color:#1e3a5f";
    banner.textContent = "Только просмотр — редактировать можно только свои сделки";
    modal.querySelector(".modal-body")?.before(banner);
  }
  modal.querySelectorAll("input, select, textarea").forEach(el => {
    if (el.id === "f-id") return;
    el.disabled = !canEdit;
  });
  modal.querySelectorAll(".modal-body button").forEach(el => {
    el.disabled = !canEdit;
  });
}

window.canEditDeal = canEditDeal;
window.canDeleteDeal = canDeleteDeal;
window.isAdmin = isAdmin;
window.ensureAuthSession = ensureAuthSession;
window.renderAuthTopbar = renderAuthTopbar;
window.authHeaders = authHeaders;
