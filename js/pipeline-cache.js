/* Кэш пайплайна: localStorage + merge lite/full */
const PIPELINE_CACHE_KEY = "itmen_pipeline_v2";
const PIPELINE_CACHE_META = "itmen_pipeline_meta_v1";

function persistStateCache(s) {
  if (!s) return;
  try {
    localStorage.setItem(PIPELINE_CACHE_KEY, JSON.stringify(s));
    localStorage.setItem(PIPELINE_CACHE_META, JSON.stringify({
      savedAt: s._savedAt || null,
      cachedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.warn("persistStateCache:", e);
  }
}

function readCacheMeta() {
  try {
    return JSON.parse(localStorage.getItem(PIPELINE_CACHE_META) || "null");
  } catch {
    return null;
  }
}

function isLiteDeal(d) {
  return !!(d && d._lite);
}

function needsFullDeal(d) {
  if (!d) return false;
  if (d._lite) return true;
  if (d.hasPains && !String(d.pains || "").trim()) return true;
  const tr = d.techResearch || {};
  const hasSeg = (tr.seekingSegments || []).length > 0;
  const hasHeavy = tr.competitorEntries || tr.changePains || tr.asIsStack || (tr.projectTasks || []).length;
  if (hasSeg && !hasHeavy) return true;
  return false;
}

function mergeDealFromLite(prev, lite) {
  if (!lite) return prev;
  if (!lite._lite) return lite;
  if (!prev) return lite;
  const merged = { ...prev, ...lite };
  merged.scores = lite.scores || prev.scores;
  merged.scoreReasons = lite.scoreReasons || prev.scoreReasons;
  merged.riskTypes = lite.riskTypes ?? prev.riskTypes;
  merged.techResearch = {
    ...(prev.techResearch || {}),
    ...(lite.techResearch || {}),
  };
  if (!lite.pains && prev.pains) merged.pains = prev.pains;
  if (!lite.riskComment && prev.riskComment) merged.riskComment = prev.riskComment;
  if (lite.hasPains) merged.hasPains = true;
  delete merged._lite;
  return merged;
}

function mergeLiteState(cached, liteState) {
  if (!liteState) return cached;
  if (!cached) return migrateState(liteState);
  const prevById = Object.fromEntries((cached.deals || []).map(d => [d.id, d]));
  const deals = (liteState.deals || []).map(d => mergeDealFromLite(prevById[d.id], d));
  return migrateState({
    ...cached,
    ...liteState,
    deals,
    lists: { ...(cached.lists || {}), ...(liteState.lists || {}) },
    scoring: liteState.scoring || cached.scoring,
    _savedAt: liteState._savedAt || cached._savedAt,
  });
}

function isServerNewer(serverState, localState) {
  const a = serverState?._savedAt;
  const b = localState?._savedAt;
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}

/** Локальная копия явно устарела (типичный сбой: в браузере 3 сделки, на сервере 200+) */
function shouldReplaceLocalWithServer(localState, serverState) {
  const localCount = (localState?.deals || []).length;
  const serverCount = (serverState?.deals || []).length;
  if (!serverCount) return false;
  if (!localCount) return true;
  if (serverCount >= 10 && localCount < serverCount * 0.5) return true;
  return false;
}

function replaceStateFromServer(serverState) {
  return migrateState(serverState);
}

function showSyncBanner(message, kind) {
  let bar = document.getElementById("sync-banner");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "sync-banner";
    bar.style.cssText = "padding:.45rem 1rem;font-size:.82rem;border-bottom:1px solid var(--border)";
    document.querySelector(".main")?.prepend(bar);
  }
  const bg = kind === "error" ? "#fff3cd" : kind === "ok" ? "#ecfdf5" : "#eff6ff";
  const fg = kind === "error" ? "#664d03" : kind === "ok" ? "#065f46" : "#1e3a5f";
  bar.style.background = bg;
  bar.style.color = fg;
  bar.innerHTML = message;
}

function clearSyncBanner() {
  document.getElementById("sync-banner")?.remove();
}

function renderAppSkeleton() {
  ["page-panel", "page-deals", "page-scoring"].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.innerHTML.trim()) return;
    el.innerHTML = `<div class="app-skeleton"><div class="sk-line sk-wide"></div><div class="sk-line"></div><div class="sk-line"></div><div class="sk-grid">${"<div class=\"sk-card\"></div>".repeat(4)}</div></div>`;
  });
}
