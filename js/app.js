/* ITMen Q3 — пайплайн: дашборд, паспорт сделок, скоринг */
const STORAGE_KEY = "itmen_pipeline_v2";
const PAGES = {
  panel: { title: "Дашборд пайплайна", icon: "📊" },
  deals: { title: "Паспорт сделок", icon: "📋" },
  scoring: { title: "Модель скоринга", icon: "⚖️" },
};

let state = null;
let editingDealIdx = null;
let modalSuggestion = null;
let saveInFlight = null;
let metricsCache = null;
let activePage = "panel";
let dashboardFilters = { owner: [], category: [], budgetPeriod: [], stage: [] };
const INACTIVE_OWNERS = ["Павел Витков"];
let dashboardEventsBound = false;

function invalidateMetricsCache() {
  metricsCache = null;
}

function getEnrichedDeals() {
  return (state.deals || []).map(enrichDeal);
}

function getDashboardDeals() {
  let deals = state?.deals || [];
  if (dashboardFilters.owner?.length) {
    const selected = new Set(dashboardFilters.owner);
    deals = deals.filter(d => selected.has(d.owner));
  }
  if (dashboardFilters.category?.length) {
    const selected = new Set(dashboardFilters.category);
    deals = deals.filter(d => selected.has(enrichDeal(d).category));
  }
  if (dashboardFilters.budgetPeriod?.length) {
    const selected = new Set(dashboardFilters.budgetPeriod);
    deals = deals.filter(d => selected.has(d.budgetPeriod || "Не определён"));
  }
  if (dashboardFilters.stage?.length) {
    const selected = new Set(dashboardFilters.stage);
    deals = deals.filter(d => selected.has(d.stage || "—"));
  }
  return deals;
}

function getDashboardOwners() {
  const fromDeals = new Set((state?.deals || []).map(d => d.owner).filter(Boolean));
  const order = (state?.lists?.owners || []).filter(o => !INACTIVE_OWNERS.includes(o));
  const owners = order.filter(o => fromDeals.has(o));
  fromDeals.forEach(o => {
    if (!INACTIVE_OWNERS.includes(o) && !owners.includes(o)) owners.push(o);
  });
  return owners.sort((a, b) => a.localeCompare(b, "ru"));
}

function dashStageOptions() {
  const base = state?.lists?.stages || window.ITMEN_INITIAL?.lists?.stages || [];
  const all = [...base];
  (state?.deals || []).forEach(d => {
    const s = d.stage;
    if (s && !all.includes(s)) all.push(s);
  });
  return all;
}

function dashBudgetPeriodOptions() {
  const base = state?.lists?.budgetPeriods || window.ITMEN_CONFIG?.budgetPeriods || [];
  const all = [...base];
  (state?.deals || []).forEach(d => {
    const p = d.budgetPeriod || "Не определён";
    if (!all.includes(p)) all.push(p);
  });
  return all;
}

function dashCategoryOptions() {
  return ["Горячая", "Тёплая", "Наблюдение", "Отказ"];
}

function renderDashFilterField(title, multiselectHtml) {
  return `<div class="dash-filter-field">
    <span class="dash-filter-label">${escapeHtml(title)}</span>
    ${multiselectHtml}
  </div>`;
}

function renderDashMultiselect(key, options, selected) {
  const sel = new Set(selected || []);
  const label = sel.size ? `${sel.size} выбр.` : "Все";
  const checkboxes = options.map(o =>
    `<label class="deals-ms-opt">
      <input type="checkbox" class="deals-ms-cb dash-ms-cb" data-dash-key="${key}" value="${escapeHtml(o)}"${sel.has(o) ? " checked" : ""}>
      <span>${escapeHtml(o)}</span>
    </label>`
  ).join("");
  return `<div class="deals-ms-filter dash-ms-filter" data-dash-key="${key}">
    <button type="button" class="deals-ms-toggle dash-ms-toggle" data-dash-key="${key}">${escapeHtml(label)} ▾</button>
    <div class="deals-ms-panel">
      <div class="deals-ms-actions">
        <button type="button" class="deals-ms-all dash-ms-all" data-dash-key="${key}">Выбрать все</button>
        <button type="button" class="deals-ms-clear dash-ms-clear" data-dash-key="${key}">Сбросить</button>
      </div>
      <div class="deals-ms-list">${checkboxes}</div>
    </div>
  </div>`;
}

function updateDashMultiselectLabel(key) {
  const wrap = document.querySelector(`.dash-ms-filter[data-dash-key="${key}"]`);
  if (!wrap) return;
  const checked = wrap.querySelectorAll(".dash-ms-cb:checked");
  const btn = wrap.querySelector(".dash-ms-toggle");
  if (btn) btn.textContent = (checked.length ? `${checked.length} выбр.` : "Все") + " ▾";
}

function syncDashMultiselect(key) {
  const wrap = document.querySelector(`.dash-ms-filter[data-dash-key="${key}"]`);
  if (!wrap) return;
  const checked = [...wrap.querySelectorAll(".dash-ms-cb:checked")].map(cb => cb.value);
  dashboardFilters[key] = checked.length ? checked : [];
  updateDashMultiselectLabel(key);
}

function closeDashMultiselectPanels(except) {
  document.querySelectorAll(".dash-ms-filter.open").forEach(el => {
    if (except && el === except) return;
    el.classList.remove("open");
  });
}

function dashFiltersActive() {
  return dashboardFilters.owner?.length || dashboardFilters.category?.length
    || dashboardFilters.budgetPeriod?.length || dashboardFilters.stage?.length;
}

function bindDashboardEvents() {
  if (dashboardEventsBound) return;
  dashboardEventsBound = true;
  const el = document.getElementById("page-panel");
  if (!el) return;

  el.addEventListener("change", e => {
    if (e.target.classList.contains("dash-ms-cb")) {
      syncDashMultiselect(e.target.dataset.dashKey);
      renderPanel(getDashboardMetrics());
    }
  });

  el.addEventListener("click", e => {
    if (e.target.id === "dash-clear-filters") {
      dashboardFilters = { owner: [], category: [], budgetPeriod: [], stage: [] };
      renderPanel(getDashboardMetrics());
      return;
    }
    const toggle = e.target.closest(".dash-ms-toggle");
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = toggle.closest(".dash-ms-filter");
      if (!wrap) return;
      const opening = !wrap.classList.contains("open");
      closeDashMultiselectPanels(opening ? wrap : null);
      wrap.classList.toggle("open", opening);
      return;
    }
    const clearBtn = e.target.closest(".dash-ms-clear");
    if (clearBtn) {
      e.preventDefault();
      e.stopPropagation();
      const key = clearBtn.dataset.dashKey;
      const wrap = clearBtn.closest(".dash-ms-filter");
      wrap?.querySelectorAll(".dash-ms-cb").forEach(cb => { cb.checked = false; });
      dashboardFilters[key] = [];
      updateDashMultiselectLabel(key);
      renderPanel(getDashboardMetrics());
      return;
    }
    const allBtn = e.target.closest(".dash-ms-all");
    if (allBtn) {
      e.preventDefault();
      e.stopPropagation();
      const key = allBtn.dataset.dashKey;
      const wrap = allBtn.closest(".dash-ms-filter");
      wrap?.querySelectorAll(".dash-ms-cb").forEach(cb => { cb.checked = true; });
      syncDashMultiselect(key);
      renderPanel(getDashboardMetrics());
      return;
    }
    if (e.target.closest(".deals-ms-opt")) {
      e.stopPropagation();
      return;
    }
    if (!e.target.closest(".dash-ms-filter")) closeDashMultiselectPanels();

    const drill = e.target.closest(".dash-drill-row, .metric-card--drill");
    if (drill) {
      e.preventDefault();
      openDealsReport(withDashboardFilters(drillSpecFromElement(drill)));
    }
  });
}

function getDashboardMetrics() {
  return calcMetrics(getDashboardDeals());
}

function getMetrics() {
  if (!metricsCache) metricsCache = calcMetrics(state.deals || []);
  return metricsCache;
}

async function loadStateFromServer() {
  if (window.ITMEN_API?.enabled) {
    try {
      const loaded = await apiLoadPipeline();
      if (loaded) return migrateState(loaded);
      return migrateState(structuredClone(window.ITMEN_INITIAL));
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
  return loadStateLocal();
}

function loadStateLocal() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return migrateState(JSON.parse(saved));
    const legacy = localStorage.getItem("itmen_pipeline_v1");
    if (legacy) {
      const parsed = migrateState(JSON.parse(legacy));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      return parsed;
    }
  } catch (_) {}
  return migrateState(structuredClone(window.ITMEN_INITIAL));
}

function migrateState(s) {
  s.deals = (s.deals || []).map(d => {
    const m = migrateDeal(d);
    if (m.budgetStatus === "Запланирован") m.budgetStatus = "Планируется согласование";
    if (m.techResearch) m.techResearch = typeof migrateTechResearch === "function" ? migrateTechResearch(m.techResearch) : m.techResearch;
    if (!m.updatedAt) m.updatedAt = s._savedAt || `${m.lastUpdate || "1970-01-01"}T12:00:00.000Z`;
    return m;
  });
  const init = window.ITMEN_INITIAL || {};
  const cfg = window.ITMEN_CONFIG || {};
  s.lists = { ...(s.lists || {}), ...(init.lists || {}) };
  if (cfg.budgetPeriods) s.lists.budgetPeriods = cfg.budgetPeriods;
  if (cfg.budgetStatuses) s.lists.budgetStatus = cfg.budgetStatuses;
  if (init.lists?.partners) s.lists.partners = init.lists.partners;
  if (s.lists?.owners?.includes("Не назначен")) {
    s.lists.owners = s.lists.owners.filter(o => o !== "Не назначен");
  }
  if (s.lists?.owners) {
    s.lists.owners = s.lists.owners.filter(o => !INACTIVE_OWNERS.includes(o));
  }
  if (!s.nextId) {
    const nums = s.deals.map(d => {
      const m = String(d.id || "").match(/D-(\d+)/);
      return m ? +m[1] : 0;
    });
    s.nextId = Math.max(0, ...nums, init.nextId || 0, 0) + 1;
  }
  syncScoringFromConfig(s);
  return s;
}

async function saveState(meta = {}) {
  if (saveInFlight) await saveInFlight;
  saveInFlight = (async () => {
    if (window.ITMEN_API?.enabled) {
      try {
        const res = await apiSavePipeline(state, {
          editedDealIds: meta.editedDealIds || [],
          deletedDealIds: meta.deletedDealIds || [],
          baseSavedAt: state._savedAt || null,
          forceFull: !!meta.forceFull,
        });
        if (res.state) state = migrateState(res.state);
        else if (res.updatedAt) state._savedAt = res.updatedAt;
        const n = res?.auditRows ?? 0;
        let auditNote = n > 0 ? ` · аудит: ${n} строк` : " · аудит: 0 изменений";
        if (res.conflicts?.length) {
          auditNote += ` · на сервере новее: ${res.conflicts.join(", ")}`;
        }
        showToast(typeof apiBackendLabel === "function"
          ? `Сохранено (${apiBackendLabel()})${auditNote}`
          : `Сохранено на сервере${auditNote}`);
      } catch (e) {
        alert("Ошибка сохранения: " + e.message);
        throw e;
      }
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      showToast(typeof apiBackendLabel === "function"
        ? `Сохранено (${apiBackendLabel()})`
        : "Данные сохранены локально");
    }
    invalidateMetricsCache();
  })();
  await saveInFlight;
  saveInFlight = null;
}

async function resetState() {
  if (!confirm("Сбросить все данные к начальным?")) return;
  state = migrateState(structuredClone(window.ITMEN_INITIAL));
  await saveState({ forceFull: true });
  renderAll();
  showToast("Данные сброшены");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function navigate(page, reportSpec) {
  activePage = page;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav a").forEach(a => a.classList.remove("active"));
  document.getElementById("page-" + page)?.classList.add("active");
  document.querySelector(`.nav a[data-page="${page}"]`)?.classList.add("active");
  document.getElementById("page-title").textContent = PAGES[page]?.title || page;
  document.body.classList.toggle("page-deals-active", page === "deals");
  document.getElementById("sidebar")?.classList.remove("open");
  if (page === "deals") {
    if (reportSpec) applyDealsReportSpec(reportSpec);
    else applyDealsReportSpec(null);
    location.hash = reportSpec ? serializeDealsReportSpec(reportSpec) : "deals";
  } else {
    location.hash = page;
  }
  renderActivePage();
}

function renderActivePage() {
  if (activePage === "panel") renderPanel(getDashboardMetrics());
  else if (activePage === "deals") {
    renderDealsTable(getEnrichedDeals());
    if (typeof syncDealsReportFiltersToUI === "function") syncDealsReportFiltersToUI();
    if (typeof renderDealsFilterBanner === "function") renderDealsFilterBanner();
  }
  else if (activePage === "scoring") renderScoring();
}

function renderAll() {
  invalidateMetricsCache();
  renderActivePage();
}

function metricCard(label, value, sub) {
  return metricCardDrill(label, value, sub, "");
}

function withDashboardFilters(spec) {
  const filters = { ...(spec.filters || {}) };
  if (dashboardFilters.owner?.length) filters.owner = [...dashboardFilters.owner];
  if (dashboardFilters.category?.length) filters.category = [...dashboardFilters.category];
  if (dashboardFilters.budgetPeriod?.length) filters.budgetPeriod = [...dashboardFilters.budgetPeriod];
  if (dashboardFilters.stage?.length) filters.stage = [...dashboardFilters.stage];
  return buildDealsReportSpec(filters, spec.preset);
}

function dashDrill(spec) {
  return drillRowAttrs(withDashboardFilters(spec));
}

function strongCommitLabels() {
  return (window.ITMEN_CONFIG?.commitStatuses || [])
    .filter(c => ["protocol", "loi", "guarantee", "contract"].includes(c.id))
    .map(c => c.label);
}

function renderPanel(m) {
  const el = document.getElementById("page-panel");
  if (!el) return;
  const n = m.pipelineCount ?? m.deals?.length ?? 0;
  const ownerOptions = getDashboardOwners();
  const categoryOptions = dashCategoryOptions();
  const periodOptions = dashBudgetPeriodOptions();
  const stageOptions = dashStageOptions();
  const maxCommit = Math.max(1, ...Object.values(m.commitCounts));
  const maxStage = Math.max(1, ...(m.stageFunnel || []).map(x => x.count));
  const maxPeriod = Math.max(1, ...(m.byBudgetPeriod || []).map(x => x.count));
  const catTotal = Math.max(1, n);
  const catColors = { "Горячая": "#c0392b", "Тёплая": "#e67e22", "Наблюдение": "#3498db", "Отказ": "#95a5a6" };
  const ownerRows = Object.entries(m.byOwner || {}).sort((a, b) => b[1].weighted - a[1].weighted);
  const budgetRows = Object.entries(m.byBudget || {}).sort((a, b) => b[1].pipeline - a[1].pipeline);

  el.innerHTML = `
    <div class="dashboard-filters">
      ${renderDashFilterField("Ответственный", renderDashMultiselect("owner", ownerOptions, dashboardFilters.owner))}
      ${renderDashFilterField("Категория", renderDashMultiselect("category", categoryOptions, dashboardFilters.category))}
      ${renderDashFilterField("Стадия", renderDashMultiselect("stage", stageOptions, dashboardFilters.stage))}
      ${renderDashFilterField("Срок", renderDashMultiselect("budgetPeriod", periodOptions, dashboardFilters.budgetPeriod))}
      ${dashFiltersActive() ? `<button type="button" class="btn btn-sm" id="dash-clear-filters">Сбросить фильтры</button>` : ""}
    </div>
    <div class="grid grid-4" style="margin-bottom:1rem">
      ${metricCardDrill("Сделок в пайплайне", n, "в текущем срезе", dashDrill(buildDealsReportSpec({}, null)))}
      ${metricCardDrill("Общий пайплайн", formatMoney(m.totalPipeline), "сумма ожидаемых сумм", dashDrill(buildDealsReportSpec({}, null)))}
      ${metricCardDrill("Взвешенный прогноз", formatMoney(m.weighted), "тёплые + горячие (балл ≥ 60)", dashDrill(buildDealsReportSpec({ category: ["Горячая", "Тёплая"], score__from: "60" })))}
      ${metricCardDrill("Подтв. бюджет", m.confirmedBudget, formatMoney(m.confirmedBudgetSum), dashDrill(buildDealsReportSpec({ budgetStatus: ["Подтверждён"] })))}
    </div>
    <div class="grid grid-4" style="margin-bottom:1rem">
      ${metricCardDrill("Горячие", m.counts["Горячая"] || 0, `${n ? Math.round((m.counts["Горячая"]||0)/n*100) : 0}%`, dashDrill(buildDealsReportSpec({ category: ["Горячая"] })))}
      ${metricCardDrill("Тёплые", m.counts["Тёплая"] || 0, "", dashDrill(buildDealsReportSpec({ category: ["Тёплая"] })))}
      ${metricCardDrill("На пилоте", m.inPilot || 0, "стадии пилота", dashDrill(buildDealsReportSpec({}, { type: "pilot" })))}
      ${metricCardDrill("Тех. соответствие", m.avgProductPct != null ? m.avgProductPct + "%" : "—", m.avgPilotPct != null ? `пилот ${m.avgPilotPct}%` : "", "")}
    </div>
    <div class="grid grid-4" style="margin-bottom:1rem">
      ${metricCardDrill("Неполные паспорта", m.incomplete, "требуют данных", dashDrill(buildDealsReportSpec({}, { type: "incomplete" })))}
      ${metricCardDrill("Флаги риска", m.riskFlags, "критичные", dashDrill(buildDealsReportSpec({}, { type: "risk" })))}
      ${metricCardDrill("Ср. лояльность", m.avgLoyalty != null ? m.avgLoyalty + " / 5" : "—", m.highLoyalty ? `высокая (≥4): ${m.highLoyalty}` : "оценка в паспорте", dashDrill(buildDealsReportSpec({ score__from: "1" })))}
      ${metricCardDrill("Наблюдение / Отказ", (m.counts["Наблюдение"]||0) + (m.counts["Отказ"]||0), "", dashDrill(buildDealsReportSpec({ category: ["Наблюдение", "Отказ"] })))}
    </div>
    <div class="grid grid-4" style="margin-bottom:1.5rem">
      ${metricCardDrill("Средний балл", m.avgScore ?? "—", "по сделкам в срезе", dashDrill(buildDealsReportSpec({ score__from: "1" })))}
      ${metricCardDrill("Полнота паспортов", m.passportCompleteness != null ? Math.round(m.passportCompleteness * 100) + "%" : "—", `${n - m.incomplete} из ${n} заполнены`, dashDrill(buildDealsReportSpec({}, { type: "incomplete" })))}
      ${metricCardDrill("Сильные коммиты", m.strongCommits || 0, "протокол / LOI / гарантия / контракт", dashDrill(buildDealsReportSpec({ commitStatus: strongCommitLabels() })))}
      ${metricCardDrill("Доля горячих", n ? Math.round((m.hotShare || 0) * 100) + "%" : "—", `${m.counts["Горячая"] || 0} из ${n}`, dashDrill(buildDealsReportSpec({ category: ["Горячая"] })))}
    </div>

    <div class="section-title">Распределение по категориям</div>
    <div class="category-bars" style="margin-bottom:1.5rem">
      ${["Горячая", "Тёплая", "Наблюдение", "Отказ"].map(cat => {
        const c = m.counts[cat] || 0;
        return `<div class="cat-bar-row dash-drill-row" ${dashDrill(buildDealsReportSpec({ category: [cat] }))} title="Открыть список сделок">
          <span class="name">${cat}</span>
          <div class="bar-wrap"><div class="bar" style="width:${(c/catTotal)*100}%;background:${catColors[cat]}"></div></div>
          <span class="count">${c}</span>
          <span class="pct">${n ? Math.round(c/n*100) : 0}%</span>
        </div>`;
      }).join("")}
    </div>

    <div class="grid grid-2" style="margin-bottom:1.5rem">
      <div class="card">
        <div class="card-header">Сроки бюджета</div>
        <div class="card-body">
          <div class="funnel">
            ${(m.byBudgetPeriod || []).map(({ period, count, pipeline }) => `
              <div class="funnel-row dash-drill-row" ${dashDrill(buildDealsReportSpec({ budgetPeriod: [period] }))} title="Открыть список сделок">
                <span class="name" title="${escapeHtml(period)}">${escapeHtml(period.length > 22 ? period.slice(0, 20) + "…" : period)}</span>
                <div class="bar-wrap"><div class="bar" style="width:${(count / maxPeriod) * 100}%;background:#805ad5"></div></div>
                <span class="count">${count}</span>
                <span class="count muted" style="min-width:4.5rem;text-align:right">${formatMoney(pipeline)}</span>
              </div>`).join("") || "<div class='muted'>Нет данных по срокам</div>"}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">Воронка коммитов</div>
        <div class="card-body">
          <div class="funnel">
            ${Object.entries(m.commitCounts).map(([name, count]) => `
              <div class="funnel-row dash-drill-row" ${dashDrill(buildDealsReportSpec({ commitStatus: [commitShortToLabel(name)] }))} title="Открыть список сделок">
                <span class="name">${escapeHtml(name)}</span>
                <div class="bar-wrap"><div class="bar" style="width:${(count / maxCommit) * 100}%"></div></div>
                <span class="count">${count}</span>
              </div>`).join("")}
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:1.5rem">
      <div class="card">
        <div class="card-header">По владельцам (менеджерам)</div>
        <div class="card-body table-wrap">
          <table class="dash-table">
            <thead><tr><th>Менеджер</th><th>Сделок</th><th>Пайплайн</th><th>Взвеш.</th><th>Гор./Тёпл.</th><th>Балл</th></tr></thead>
            <tbody>${ownerRows.map(([name, v]) => `<tr class="dash-drill-row" ${dashDrill(buildDealsReportSpec({ owner: [name] }))} title="Открыть сделки менеджера">
              <td>${escapeHtml(name)}</td><td>${v.count}</td>
              <td class="num">${formatMoney(v.pipeline)}</td>
              <td class="num">${formatMoney(v.weighted)}</td>
              <td>${v.hot}/${v.warm}</td>
              <td>${v.avgScore ?? "—"}</td>
            </tr>`).join("") || "<tr><td colspan='6' class='muted'>Нет данных</td></tr>"}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header">Воронка по стадиям (amoCRM)</div>
        <div class="card-body">
          <div class="funnel">
            ${(m.stageFunnel || []).map(({ stage, count }) => `
              <div class="funnel-row dash-drill-row" ${dashDrill(buildDealsReportSpec({ stage: [stage] }))} title="Открыть список сделок">
                <span class="name" title="${escapeHtml(stage)}">${escapeHtml(stage.length > 22 ? stage.slice(0, 20) + "…" : stage)}</span>
                <div class="bar-wrap"><div class="bar" style="width:${(count / maxStage) * 100}%;background:#2c5282"></div></div>
                <span class="count">${count}</span>
              </div>`).join("") || "<div class='muted'>Нет сделок</div>"}
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:1.5rem">
      <div class="card">
        <div class="card-header">Статус бюджета</div>
        <div class="card-body table-wrap">
          <table class="dash-table">
            <thead><tr><th>Статус</th><th>Сделок</th><th>Сумма пайплайна</th></tr></thead>
            <tbody>${budgetRows.map(([st, v]) => `<tr class="dash-drill-row" ${dashDrill(buildDealsReportSpec({ budgetStatus: [st] }))} title="Открыть список сделок">
              <td>${escapeHtml(st)}</td><td>${v.count}</td><td class="num">${formatMoney(v.pipeline)}</td>
            </tr>`).join("") || "<tr><td colspan='3' class='muted'>—</td></tr>"}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header">Что ищут клиенты (сегменты)</div>
        <div class="card-body">
          <div class="funnel">
            ${(m.topSegments || []).map(([seg, count]) => `
              <div class="funnel-row dash-drill-row" ${dashDrill(buildDealsReportSpec({}, { type: "segment", value: seg }))} title="Открыть список сделок">
                <span class="name">${escapeHtml(seg)}</span>
                <div class="bar-wrap"><div class="bar" style="width:${(count / Math.max(1, m.topSegments[0]?.[1] || 1)) * 100}%;background:#38a169"></div></div>
                <span class="count">${count}</span>
              </div>`).join("") || "<div class='muted'>Заполните блок «Что ищут» в паспортах</div>"}
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1.5rem">
      <div class="card-header">Top-10 сделок по взвешенному прогнозу</div>
      <div class="card-body table-wrap">
        <table class="dash-table">
          <thead><tr><th>Клиент</th><th>Владелец</th><th>Стадия</th><th>Ожид. сумма</th><th>Взвеш.</th><th>Балл</th><th>Категория</th></tr></thead>
          <tbody>${(m.topDeals || []).map(d => `<tr class="dash-drill-row" ${dashDrill(buildDealsReportSpec({ customer: d.customer }))} title="Открыть в таблице">
            <td><strong>${escapeHtml(d.customer)}</strong></td>
            <td>${escapeHtml(d.owner)}</td>
            <td><small>${escapeHtml(d.stage)}</small></td>
            <td class="num">${formatMoney(d.expectedAmount ?? d.amount)}</td>
            <td class="num">${formatMoney(d.weighted)}</td>
            <td>${d.score ?? "—"}</td>
            <td>${categoryBadge(d.category)}</td>
          </tr>`).join("") || "<tr><td colspan='7' class='muted'>Нет сделок</td></tr>"}
          </tbody>
        </table>
      </div>
    </div>

    ${(m.attention || []).length ? `
    <div class="card" style="margin-bottom:1.5rem">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:.75rem">
        <span>⚠ Требуют внимания</span>
        <button type="button" class="btn btn-sm dash-drill-row" ${dashDrill(buildDealsReportSpec({}, { type: "attention" }))}>Показать все →</button>
      </div>
      <div class="card-body table-wrap">
        <table class="dash-table">
          <thead><tr><th>Клиент</th><th>Владелец</th><th>Проблема</th><th>Задача до</th><th></th></tr></thead>
          <tbody>${m.attention.map(d => {
            const issues = [];
            if (d.quality === "Неполный") issues.push("Неполный паспорт");
            if (d.daysTo != null && d.daysTo < 0) issues.push("Просрочена задача");
            if (d.category === "Горячая" && d.budgetStatus === "Нет бюджета") issues.push("Горячая без бюджета");
            if (d.riskFlag && !issues.includes(d.riskFlag)) issues.push(d.riskFlag);
            const idx = state.deals.findIndex(x => x.id === d.id);
            return `<tr>
              <td>${escapeHtml(d.customer)}</td>
              <td>${escapeHtml(d.owner)}</td>
              <td>${issues.map(i => `<span class="badge badge-warn">${escapeHtml(i)}</span>`).join(" ")}</td>
              <td>${escapeHtml(d.taskDue)}${d.daysTo != null ? ` <small>(${d.daysTo} дн.)</small>` : ""}</td>
              <td>${idx >= 0 ? `<button class="btn btn-sm" onclick="openDealModal(${idx})">✏️</button>` : ""}</td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>
      </div>
    </div>` : ""}

    <div class="note">${window.ITMEN_API?.backend === "gas"
      ? "Данные в Google Таблице · автосохранение при изменениях."
      : window.ITMEN_API?.enabled
        ? "Данные на сервере · автосохранение при изменениях."
        : "Данные сохраняются локально в браузере."} Каталог вендоров: ${catalogCountLabel?.() ?? "—"} позиций.</div>`;
}

function renderScoring() {
  const el = document.getElementById("page-scoring");
  if (!el) return;
  const items = getMergedScoringItems(state.scoring);
  const legendBlocks = items.map(s => {
    const scale = buildScoreScale(s);
    return `<div class="score-legend-block">
      <h4>${escapeHtml(s.name)} <span class="weight-tag">${Math.round(s.weight * 100)}%</span></h4>
      <p class="legend-question">${escapeHtml(s.question || "")}</p>
      <div class="score-legend-grid">
        ${[5, 4, 3, 2, 1].map(n => `<div class="legend-level"><span class="lvl">${n}</span><span>${escapeHtml(scale[n] || "—")}</span></div>`).join("")}
        <div class="legend-level muted"><span class="lvl">0</span><span>${escapeHtml(s.s0 || "—")}</span></div>
      </div>
    </div>`;
  }).join("");

  el.innerHTML = `
    <div class="card"><div class="table-wrap"><table class="rubric-table">
      <thead><tr><th>Критерий</th><th>Вопрос</th><th>Кол.</th><th>Вес</th><th>5</th><th>4</th><th>3</th><th>2</th><th>1</th><th>0</th><th>Ответственный</th></tr></thead>
      <tbody>${items.map(s => {
        const scale = buildScoreScale(s);
        return `<tr>
        <td>${escapeHtml(s.name)}</td>
        <td class="muted" style="max-width:220px;font-size:.75rem">${escapeHtml(s.question || "")}</td>
        <td>${s.col}</td><td class="weight">${Math.round(s.weight * 100)}%</td>
        <td>${escapeHtml(scale[5])}</td><td>${escapeHtml(scale[4])}</td><td>${escapeHtml(scale[3])}</td>
        <td>${escapeHtml(scale[2])}</td><td>${escapeHtml(scale[1])}</td><td>${escapeHtml(s.s0)}</td>
        <td>${escapeHtml(s.owner)}</td></tr>`;
      }).join("")}
      </tbody>
    </table></div></div>
    <div class="section-title">Легенда шкалы 1–5 (используется в паспорте сделки)</div>
    <div class="score-legend-panel">${legendBlocks}</div>
    <div class="section-title">Пороги категорий</div>
    <div class="grid grid-4">
      ${[["Горячая", "≥ 80", "badge-hot"], ["Тёплая", "≥ 60", "badge-warm"], ["Наблюдение", "≥ 40", "badge-watch"], ["Отказ", "< 40", "badge-drop"]]
        .map(([n, t, c]) => `<div class="metric-card"><span class="badge ${c}">${n}</span><div class="value" style="font-size:1rem;margin-top:.5rem">${t}</div></div>`).join("")}
    </div>`;
}

function previewDealId() {
  return "D-" + String(state.nextId || 1).padStart(3, "0");
}

function consumeDealId() {
  const id = previewDealId();
  state.nextId = (state.nextId || 1) + 1;
  return id;
}

function hint(text) {
  return `<span class="field-hint" title="${escapeHtml(text)}">ⓘ</span>`;
}

function commitSelect(id, value) {
  const statuses = window.ITMEN_CONFIG?.commitStatuses || [];
  const v = normalizeCommitStatus(value);
  return `<select id="${id}" onchange="updateCommitHint()">
    ${statuses.map(c => `<option value="${c.id}" ${c.id === v ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}
  </select>
  <div class="commit-hint" id="commit-hint">${escapeHtml(statuses.find(c => c.id === v)?.desc || "")}</div>`;
}

function typeSelect(id, types, value) {
  return `<select id="${id}">
    ${types.map(t => `<option value="${t.id}" ${t.id === value ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}
  </select>`;
}

function collectRiskTypesFromForm() {
  return [...document.querySelectorAll(".risk-type-cb:checked")].map(x => x.value);
}

function renderRiskCheckboxes(selected) {
  const set = new Set(selected || []);
  const types = window.ITMEN_CONFIG?.riskTypes || [];
  return `<div class="checkbox-group risk-checkbox-group" id="risk-types-group">${types.map(t =>
    `<label class="checkbox-label"><input type="checkbox" class="risk-type-cb" value="${t.id}" ${set.has(t.id) ? "checked" : ""}> ${escapeHtml(t.label)}</label>`
  ).join("")}</div>`;
}

function refreshModelScores() {
  const keepLoyalty = document.getElementById("s-loyalty")?.value;
  const draft = {
    ...collectDealDraft(),
    techResearch: collectTechResearch(),
  };
  modalSuggestion = suggestScores(draft);
  applyModelScores(true);
  if (keepLoyalty != null) {
    const el = document.getElementById("s-loyalty");
    if (el) el.value = keepLoyalty;
  }
  showToast("Скоринг пересчитан по данным формы");
}

function collectDealDraft() {
  return {
    stage: val("f-stage"),
    budgetStatus: val("f-budgetStatus"),
    commitStatus: val("f-commitStatus"),
    amount: +val("f-amount") || 0,
    expectedBudget: +val("f-expectedBudget") || 0,
    pains: val("f-pains"),
    riskTypes: collectRiskTypesFromForm(),
    riskType: collectRiskTypesFromForm()[0] || "none",
  };
}

function renderScoreSection(deal, suggestion) {
  const items = getMergedScoringItems(state.scoring);
  const manualKeys = new Set(window.ITMEN_CONFIG?.manualScoreKeys || ["loyalty"]);

  const cards = items.map(c => {
    const cur = deal.scores?.[c.key] ?? 0;
    const sug = suggestion.scores[c.key] ?? 0;
    const isManual = manualKeys.has(c.key) || c.manualOnly;
    const reason = deal.scoreReasons?.[c.key] || suggestion.reasons[c.key] || "";
    const overridden = deal.scoresOverridden?.[c.key];
    const hist = (deal.scoreHistory || []).filter(h => h.scores?.[c.key] != null).slice(-3);
    const histHtml = hist.length ? `<div class="score-history">${hist.map(h =>
      `<div class="hist-row"><span>${h.date}</span><span>${h.source === "model" ? "модель" : h.source === "import" ? "импорт" : "ручное"}</span><span>${h.scores[c.key]}</span></div>`
    ).join("")}</div>` : "";
    const scale = buildScoreScale(c);
    const suggestHtml = isManual
      ? `<div class="score-suggest muted">Только ручная оценка · модель не подставляет</div>`
      : `<div class="score-suggest">Модель: <strong>${sug}</strong>${overridden ? ' · <span class="badge badge-warn">изменено</span>' : ""}</div>`;

    return `<div class="score-card ${overridden ? "overridden" : ""} ${isManual ? "manual-score" : ""}">
      <div class="score-card-head">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="weight-tag">${Math.round(c.weight * 100)}%</span>
        ${isManual ? '<span class="badge badge-warn">ручная</span>' : ""}
      </div>
      <p class="legend-question">${escapeHtml(c.question || "")}</p>
      ${suggestHtml}
      <select id="s-${c.key}" onchange="markScoreOverride('${c.key}')">
        ${[0, 1, 2, 3, 4, 5].map(n => `<option value="${n}" ${+cur === n ? "selected" : ""}>${n}</option>`).join("")}
      </select>
      <div class="score-reason">${escapeHtml(reason)}</div>
      <div class="score-legend-inline">
        ${[5, 4, 3, 2, 1].map(n =>
          `<div class="legend-row"><span class="lvl">${n}</span><span>${escapeHtml(scale[n] || "—")}</span></div>`
        ).join("")}
        <div class="legend-row muted"><span class="lvl">0</span><span>${escapeHtml(c.s0 || "—")}</span></div>
      </div>
      ${histHtml}
    </div>`;
  }).join("");

  return `
    <div class="score-toolbar">
      <button type="button" class="btn btn-sm" onclick="applyModelScores()">↺ Применить оценку модели</button>
      <button type="button" class="btn btn-sm" onclick="refreshModelScores()">⟳ Пересчитать по форме</button>
      <span class="muted">Лояльность — только вручную. Коммит считается из «Статус коммита».</span>
    </div>
    <div class="scores-panel">${cards}</div>`;
}

function ensureArchitectureLoaded() {
  if (window.ITMEN_ARCHITECTURE) return Promise.resolve();
  if (window._archLoadPromise) return window._archLoadPromise;
  window._archLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/architecture-data.js";
    s.async = true;
    s.onload = () => {
      window._itmenCatalogCache = null;
      resolve();
    };
    s.onerror = () => reject(new Error("Не удалось загрузить каталог вендоров"));
    document.head.appendChild(s);
  });
  return window._archLoadPromise;
}

function openDealModal(idx) {
  openDealModalAsync(idx).catch(e => alert(e.message));
}

async function openDealModalAsync(idx) {
  await ensureArchitectureLoaded();
  editingDealIdx = idx ?? null;
  const raw = idx != null ? state.deals[idx] : emptyDeal();
  const d = migrateDeal(raw);
  modalSuggestion = suggestScores(d);
  const hasScores = Object.values(d.scores || {}).some(v => v > 0);
  if (!hasScores && modalSuggestion) {
    d.scores = { ...modalSuggestion.scores };
    d.scoreReasons = { ...modalSuggestion.reasons };
    d.scores.loyalty = d.scores.loyalty ?? 0;
    d.scoreReasons.loyalty = "Оценивается только вручную";
  }
  const L = state.lists;
  const isNew = idx == null;

  document.getElementById("deal-modal").querySelector(".modal-body").innerHTML = `
    <div class="form-section">
      <div class="form-section-title">Основное</div>
      <div class="form-grid">
        <div>
          <label>ID сделки ${hint("Генерируется автоматически")}</label>
          <input id="f-id" value="${escapeHtml(d.id)}" readonly class="readonly">
        </div>
        <div><label>Клиент</label><input id="f-customer" value="${escapeHtml(d.customer)}" placeholder="Название компании"></div>
        <div><label>Отрасль</label>${select("f-industry", L.industries, d.industry)}</div>
        <div><label>Владелец</label>${select("f-owner", L.owners, d.owner || L.owners[0])}</div>
        <div><label>Стадия (amoCRM)</label>${select("f-stage", L.stages, d.stage)}</div>
        <div><label>Ожидаемая сумма, ₽ ${hint(window.ITMEN_CONFIG?.fieldHints?.expectedAmount || "")}</label><input type="number" id="f-amount" value="${d.amount || 0}"></div>
        <div><label>Ожидаемый бюджет, ₽ ${hint(window.ITMEN_CONFIG?.fieldHints?.expectedBudget || "")}</label><input type="number" id="f-expectedBudget" value="${d.expectedBudget || d.budgetAmount || 0}"></div>
        <div><label>Партнёр</label>${select("f-partner", L.partners || ["Нет партнёра"], d.partner || "Нет партнёра")}</div>
        <div><label>Скидка партнёру, % ${hint(window.ITMEN_CONFIG?.fieldHints?.partnerDiscount || "")}</label><input type="number" step="0.1" min="0" max="100" id="f-partnerDiscount" value="${d.partnerDiscount || 0}"></div>
        <div><label>Скидка клиенту, % ${hint(window.ITMEN_CONFIG?.fieldHints?.clientDiscount || "")}</label><input type="number" step="0.1" min="0" max="100" id="f-clientDiscount" value="${d.clientDiscount || 0}"></div>
        <div><label>Вероятность (ручная, 0–1)</label><input type="number" step="0.05" min="0" max="1" id="f-manualProb" value="${d.manualProb || 0}"></div>
        <div>
          <label>Срок ближайшей задачи ${hint(window.ITMEN_CONFIG?.fieldHints?.taskDue || "")}</label>
          <input type="date" id="f-taskDue" value="${d.taskDue || ""}">
        </div>
        <div>
          <label>Плановый период бюджета ${hint(window.ITMEN_CONFIG?.fieldHints?.budgetPeriod || "")}</label>
          ${select("f-budgetPeriod", L.budgetPeriods || ["Не определён"], d.budgetPeriod || "Не определён")}
        </div>
        <div><label>Статус бюджета</label>${select("f-budgetStatus", L.budgetStatus, d.budgetStatus, "toggleBudgetPlannedDate()")}</div>
        ${renderBudgetPlannedFields(d.budgetPlannedMonth, d.budgetPlannedYear, d.budgetStatus)}
        <div><label>Статус коммита клиента</label>${commitSelect("f-commitStatus", d.commitStatus)}</div>
        <div class="full"><label>Ключевые боли</label><textarea id="f-pains" placeholder="Что болит у клиента">${escapeHtml(d.pains)}</textarea></div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Риски</div>
      <div class="form-grid">
        <div class="full">
          <label>Критические риски</label>
          <p class="muted" style="font-size:.75rem;margin-bottom:.35rem">Можно выбрать несколько</p>
          ${renderRiskCheckboxes(migrateDeal(d).riskTypes)}
        </div>
        <div class="full">
          <label>Комментарий к риску</label>
          <textarea id="f-riskComment" placeholder="Детали риска и план митигации">${escapeHtml(d.riskComment)}</textarea>
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Техническое исследование</div>
      ${renderTechSection(d.techResearch)}
    </div>

    <div class="form-section">
      <div class="form-section-title">Скоринг сделки</div>
      ${renderScoreSection(d, modalSuggestion)}
    </div>`;

  toggleBudgetPlannedDate();
  document.getElementById("deal-modal").classList.add("open");
}

function updateCommitHint() {
  const id = val("f-commitStatus");
  const c = (window.ITMEN_CONFIG?.commitStatuses || []).find(x => x.id === id);
  const el = document.getElementById("commit-hint");
  if (el && c) el.textContent = c.desc;
}

function applyModelScores(silent) {
  if (!modalSuggestion) return;
  const manualKeys = new Set(window.ITMEN_CONFIG?.manualScoreKeys || ["loyalty"]);
  const criteria = window.ITMEN_CONFIG?.scoreCriteria || [];
  criteria.forEach(c => {
    if (manualKeys.has(c.key)) return;
    const el = document.getElementById("s-" + c.key);
    if (el) el.value = modalSuggestion.scores[c.key] ?? 0;
  });
  if (!silent) showToast("Оценки модели подставлены (лояльность не менялась)");
}

function markScoreOverride(key) {
  const card = document.getElementById("s-" + key)?.closest(".score-card");
  if (card) card.classList.add("overridden");
}

function emptyDeal() {
  const defaultOwner = state.lists?.owners?.[0] || "Аркадий Мерлейн";
  return {
    id: previewDealId(),
    customer: "",
    industry: "Не определена",
    owner: defaultOwner,
    stage: state.lists?.stages?.[0] || "Взят в работу",
    dealType: "Текущий пайплайн",
    amount: 0,
    expectedBudget: 0,
    partner: "Нет партнёра",
    partnerDiscount: 0,
    clientDiscount: 0,
    manualProb: 0,
    taskDue: new Date().toISOString().slice(0, 10),
    budgetPeriod: "Не определён",
    budgetStatus: "Неизвестно",
    budgetPlannedMonth: null,
    budgetPlannedYear: null,
    budgetAmount: 0,
    techResearch: typeof defaultTechResearch === "function" ? defaultTechResearch() : { classEntries: {} },
    pains: "",
    capabilities: "",
    dml: "Не определён",
    scores: { loyalty: 0, commit: 0, budget: 0, fit: 0, timing: 0, competitive: 0, access: 0, technical: 0, commercial: 0 },
    scoreReasons: {},
    scoreHistory: [],
    scoresOverridden: {},
    riskTypes: [],
    riskType: "none",
    riskComment: "",
    commitStatus: "none",
    lastUpdate: new Date().toISOString().slice(0, 10),
    amoId: null,
  };
}

function collectScoresFromForm(prevDeal) {
  const scores = {};
  const scoreReasons = { ...(prevDeal?.scoreReasons || {}) };
  const scoresOverridden = { ...(prevDeal?.scoresOverridden || {}) };
  const scoreHistory = [...(prevDeal?.scoreHistory || [])];
  const criteria = window.ITMEN_CONFIG?.scoreCriteria || [];
  const suggestion = modalSuggestion || suggestScores(prevDeal || {});
  let changed = false;
  const newScores = {};

  criteria.forEach(c => {
    const v = +val("s-" + c.key) || 0;
    newScores[c.key] = v;
    scores[c.key] = v;
    const sug = suggestion.scores[c.key] ?? 0;
    if (v !== sug) scoresOverridden[c.key] = true;
    if ((prevDeal?.scores?.[c.key] ?? null) !== v) changed = true;
    if (!scoreReasons[c.key]) scoreReasons[c.key] = suggestion.reasons[c.key] || "";
  });

  if (changed) {
    scoreHistory.push({
      date: new Date().toISOString().slice(0, 10),
      source: Object.keys(scoresOverridden).length ? "manual" : "model",
      scores: { ...newScores },
    });
  }

  return { scores, scoreReasons, scoresOverridden, scoreHistory };
}

function saveDealModal() {
  saveDealModalAsync().catch(e => alert(e.message));
}

async function saveDealModalAsync() {
  const prev = editingDealIdx != null ? state.deals[editingDealIdx] : null;
  const scoreData = collectScoresFromForm(prev);
  const riskTypes = collectRiskTypesFromForm();

  const deal = {
    id: val("f-id"),
    customer: val("f-customer").trim(),
    industry: val("f-industry"),
    owner: val("f-owner"),
    stage: val("f-stage"),
    dealType: "Текущий пайплайн",
    amount: +val("f-amount") || 0,
    expectedBudget: +val("f-expectedBudget") || 0,
    partner: val("f-partner"),
    partnerDiscount: +val("f-partnerDiscount") || 0,
    clientDiscount: +val("f-clientDiscount") || 0,
    manualProb: +val("f-manualProb") || 0,
    taskDue: val("f-taskDue"),
    budgetPeriod: val("f-budgetPeriod"),
    budgetStatus: val("f-budgetStatus"),
    budgetPlannedMonth: val("f-budgetStatus") === "Планируется согласование" ? (+val("f-budgetPlannedMonth") || null) : null,
    budgetPlannedYear: val("f-budgetStatus") === "Планируется согласование" ? (+val("f-budgetPlannedYear") || null) : null,
    commitStatus: val("f-commitStatus"),
    pains: val("f-pains"),
    riskTypes,
    riskType: riskTypes[0] || "none",
    riskComment: val("f-riskComment"),
    techResearch: collectTechResearch(),
    updatedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString().slice(0, 10),
    ...scoreData,
    budgetAmount: +val("f-expectedBudget") || 0,
    capabilities: prev?.capabilities || "",
    dml: prev?.dml || "Не определён",
    amoId: prev?.amoId || null,
  };

  if (deal.budgetStatus === "Планируется согласование" && (!deal.budgetPlannedMonth || !deal.budgetPlannedYear)) {
    alert("Укажите месяц и год планируемого согласования бюджета");
    return;
  }
  if (!deal.customer) {
    alert("Укажите клиента");
    return;
  }
  if (riskTypes.includes("other") && !deal.riskComment.trim()) {
    alert("Для риска «Другое» нужен комментарий");
    return;
  }
  const tr = deal.techResearch;
  if (tr?.seekingSegments?.includes("other") && !tr.seekingOtherLabel?.trim()) {
    alert("Укажите, что ищут в поле «Другое»");
    return;
  }

  if (editingDealIdx != null) state.deals[editingDealIdx] = deal;
  else {
    deal.id = consumeDealId();
    state.deals.push(deal);
  }

  closeModal("deal-modal");
  await saveState({ editedDealIds: [deal.id] });
  renderAll();
}

function deleteDeal(idx) {
  deleteDealAsync(idx).catch(e => alert(e.message));
}

async function deleteDealAsync(idx) {
  if (!confirm("Удалить сделку " + state.deals[idx].id + "?")) return;
  const deletedId = state.deals[idx].id;
  state.deals.splice(idx, 1);
  invalidateMetricsCache();
  await saveState({ deletedDealIds: [deletedId] });
  renderAll();
}

function select(id, options, value, onchange) {
  const oc = onchange ? ` onchange="${onchange}"` : "";
  return `<select id="${id}"${oc}>${options.map(o => `<option value="${escapeHtml(o)}" ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
}

function val(id) { return document.getElementById(id)?.value ?? ""; }
function closeModal(id) { document.getElementById(id)?.classList.remove("open"); }

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "itmen_pipeline_export.json";
  a.click();
  showToast("JSON экспортирован");
}

async function importJson(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      state = migrateState(JSON.parse(e.target.result));
      await saveState({ forceFull: true });
      renderAll();
      showToast("Данные импортированы");
    } catch (_) { alert("Ошибка чтения JSON"); }
  };
  reader.readAsText(file);
  input.value = "";
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.ITMEN_API?.enabled) {
    try {
      state = await loadStateFromServer();
    } catch (e) {
      alert("Не удалось загрузить данные: " + (e.message || "ошибка сервера")
        + "\n\nПроверьте URL в js/gas-config.js и развёртывание Apps Script (доступ «Все»).");
      return;
    }
  } else {
    state = loadStateLocal();
    if (typeof showSetupBanner === "function") showSetupBanner();
  }

  document.getElementById("nav").innerHTML = Object.entries(PAGES).map(([k, v]) =>
    `<a href="#${k}" data-page="${k}"><span class="icon">${v.icon}</span>${v.title}</a>`
  ).join("");

  document.querySelectorAll(".nav a").forEach(a => {
    a.addEventListener("click", e => { e.preventDefault(); navigate(a.dataset.page); });
  });

  document.getElementById("menu-toggle")?.addEventListener("click", () =>
    document.getElementById("sidebar").classList.toggle("open"));
  document.querySelectorAll(".modal-overlay").forEach(m => {
    m.addEventListener("click", e => { if (e.target === m) m.classList.remove("open"); });
  });

  bindDashboardEvents();
  if (typeof bindDealsTableEvents === "function") bindDealsTableEvents();
  renderAll();
  const boot = parseLocationHash();
  navigate(boot.page || "panel", boot.spec);
  window.addEventListener("hashchange", () => {
    const p = parseLocationHash();
    if (p.page === "deals" && activePage === "deals") {
      applyDealsReportSpec(p.spec);
      if (typeof syncDealsReportFiltersToUI === "function") syncDealsReportFiltersToUI();
      updateDealsTableBody(getEnrichedDeals());
      if (typeof renderDealsFilterBanner === "function") renderDealsFilterBanner();
      return;
    }
    if (p.page !== activePage) navigate(p.page, p.spec);
  });
});
window.openDealModal = openDealModal;
window.saveDealModal = saveDealModal;
window.deleteDeal = deleteDeal;
window.closeModal = closeModal;
window.renderAll = renderAll;
window.applyModelScores = applyModelScores;
window.markScoreOverride = markScoreOverride;
window.updateCommitHint = updateCommitHint;
window.syncTechSegmentPanels = syncTechSegmentPanels;
window.addCompetitorRow = addCompetitorRow;
window.removeCompetitorRow = removeCompetitorRow;
window.toggleCompReasonFields = toggleCompReasonFields;
window.onVendorSearch = onVendorSearch;
window.hideVendorDropdownDelayed = hideVendorDropdownDelayed;
window.selectVendorOpt = selectVendorOpt;
window.clearVendorPicker = clearVendorPicker;
window.addTaskRow = addTaskRow;
window.removeTaskRow = removeTaskRow;
window.toggleBudgetPlannedDate = toggleBudgetPlannedDate;
window.refreshModelScores = refreshModelScores;
