/* Динамика пайплайна — тренды и топ изменений балла */
let dynamicsPeriod = "week";
let dynamicsData = null;
let dynamicsLoading = false;

async function apiLoadDynamics(period) {
  if (window.ITMEN_API?.backend === "pocketbase") {
    return apiFetch(`/api/dynamics?period=${encodeURIComponent(period)}`);
  }
  if (window.ITMEN_API?.backend !== "gas") return null;
  const url = `${window.ITMEN_API.gasUrl}?action=dynamics&period=${encodeURIComponent(period)}`;
  const res = await fetch(url, { redirect: "follow" });
  const data = JSON.parse(await res.text());
  if (data.error) throw new Error(data.error);
  return data;
}

function formatDelta(n, suffix = "") {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${suffix === "₽" ? formatMoney(n) : n}${suffix && suffix !== "₽" ? suffix : ""}`;
}

function deltaClass(n) {
  if (n > 0) return "delta-up";
  if (n < 0) return "delta-down";
  return "delta-flat";
}

function renderDynamicsTrendChart(trend) {
  if (!trend?.length) return `<div class="muted">Нет данных за период. Первый снапшот — сегодня в 23:59 МСК.</div>`;
  const max = Math.max(1, ...trend.map(p => p.totalPipeline || 0));
  return `<div class="dynamics-trend">
    ${trend.map(p => {
      const h = Math.max(4, Math.round(((p.totalPipeline || 0) / max) * 100));
      const label = p.live ? "сейчас" : String(p.date).slice(5);
      return `<div class="dynamics-trend-col" title="${escapeHtml(p.date)}: ${formatMoney(p.totalPipeline)}">
        <div class="dynamics-trend-bar" style="height:${h}%"></div>
        <span class="dynamics-trend-label">${escapeHtml(label)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

function renderDynamicsDeltaTable(rows, kind) {
  if (!rows?.length) {
    return `<div class="muted">Нет ${kind === "gain" ? "роста" : "падения"} балла за период</div>`;
  }
  return `<table class="dash-table dynamics-delta-table">
    <thead><tr><th>Клиент</th><th>Владелец</th><th>Было</th><th>Сейчас</th><th>Δ</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="dash-drill-row" ${drillRowAttrs(buildDealsReportSpec({ customer: r.customer }))} title="Открыть в таблице">
      <td>${escapeHtml(r.customer)}</td>
      <td>${escapeHtml(r.owner)}</td>
      <td class="num">${r.was}</td>
      <td class="num">${r.now}</td>
      <td class="num ${deltaClass(r.delta)}">${r.delta > 0 ? "+" : ""}${r.delta}</td>
    </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderDynamicsBlock(data) {
  const el = document.getElementById("dynamics-block");
  if (!el) return;
  if (!data) {
    el.innerHTML = window.ITMEN_API?.enabled
      ? `<div class="muted">Загрузка динамики…</div>`
      : `<div class="muted">Динамика доступна при подключении к серверу.</div>`;
    return;
  }
  const s = data.summary || {};
  const periodLabel = { week: "неделя", month: "месяц", quarter: "квартал" }[data.period] || data.period;
  el.innerHTML = `
    <div class="dynamics-toolbar">
      <div class="dynamics-period-tabs">
        ${["week", "month", "quarter"].map(p =>
          `<button type="button" class="btn btn-sm dynamics-period-btn${dynamicsPeriod === p ? " active" : ""}" data-dyn-period="${p}">${p === "week" ? "Неделя" : p === "month" ? "Месяц" : "Квартал"}</button>`
        ).join("")}
      </div>
      ${!data.hasSnapshots ? `<span class="muted dynamics-hint">Снапшоты с сегодняшнего дня (23:59 МСК). Пока — данные из аудита.</span>` : ""}
    </div>
    <div class="grid grid-4 dynamics-summary" style="margin-bottom:1rem">
      <div class="metric-card"><div class="label">Δ Пайплайн</div><div class="value ${deltaClass(s.pipelineDelta)}">${formatDelta(s.pipelineDelta, "₽")}</div><div class="sub">за ${periodLabel}</div></div>
      <div class="metric-card"><div class="label">Δ Взвешенный</div><div class="value ${deltaClass(s.weightedDelta)}">${formatDelta(s.weightedDelta, "₽")}</div><div class="sub">горячие + тёплые</div></div>
      <div class="metric-card"><div class="label">Δ Средний балл</div><div class="value ${deltaClass(s.avgScoreDelta)}">${formatDelta(s.avgScoreDelta)}</div><div class="sub">${s.baselineDate ? `от ${s.baselineDate}` : "база из аудита"}</div></div>
      <div class="metric-card"><div class="label">Δ Сделок</div><div class="value ${deltaClass(s.dealCountDelta)}">${formatDelta(s.dealCountDelta)}</div><div class="sub">${data.snapshotDays || 0} дн. снапшотов</div></div>
    </div>
    <div class="grid grid-2">
      <div>
        <div class="section-title">Тренд пайплайна (₽)</div>
        ${renderDynamicsTrendChart(data.pipelineTrend)}
      </div>
      <div class="grid grid-2">
        <div>
          <div class="section-title">Топ роста балла</div>
          ${renderDynamicsDeltaTable(data.topGains, "gain")}
        </div>
        <div>
          <div class="section-title">Топ падения балла</div>
          ${renderDynamicsDeltaTable(data.topLosses, "loss")}
        </div>
      </div>
    </div>`;
}

async function refreshDynamics(period) {
  if (!window.ITMEN_API?.enabled) {
    dynamicsData = null;
    renderDynamicsBlock(null);
    return;
  }
  dynamicsPeriod = period || dynamicsPeriod;
  dynamicsLoading = true;
  renderDynamicsBlock(null);
  try {
    dynamicsData = await apiLoadDynamics(dynamicsPeriod);
    renderDynamicsBlock(dynamicsData);
  } catch (e) {
    console.error(e);
    const el = document.getElementById("dynamics-block");
    if (el) el.innerHTML = `<div class="muted">Не удалось загрузить динамику: ${escapeHtml(e.message || "ошибка")}</div>`;
  } finally {
    dynamicsLoading = false;
  }
}

let dynamicsObserver = null;

function scheduleDynamicsLoad() {
  if (!window.ITMEN_API?.enabled) return;
  if (typeof activePage !== "undefined" && activePage !== "panel") return;
  const block = document.getElementById("dynamics-block");
  if (!block) return;
  dynamicsObserver?.disconnect();
  if (dynamicsData && dynamicsData.period === dynamicsPeriod) {
    renderDynamicsBlock(dynamicsData);
    return;
  }
  renderDynamicsBlock(null);
  dynamicsObserver = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting) && !dynamicsLoading) {
      dynamicsObserver?.disconnect();
      refreshDynamics(dynamicsPeriod);
    }
  }, { rootMargin: "120px", threshold: 0.01 });
  dynamicsObserver.observe(block);
}

function bindDynamicsEvents() {
  const panel = document.getElementById("page-panel");
  if (!panel || panel.dataset.dynBound) return;
  panel.dataset.dynBound = "1";
  panel.addEventListener("click", e => {
    const btn = e.target.closest(".dynamics-period-btn");
    if (!btn) return;
    e.preventDefault();
    refreshDynamics(btn.dataset.dynPeriod);
  });
}

function renderBudgetMatrix(m) {
  const periods = m.budgetMatrixPeriods || [];
  const statuses = m.budgetMatrixStatuses || [];
  const matrix = m.budgetMatrix || {};
  if (!periods.length || !statuses.length) {
    return `<div class="muted">Нет данных для матрицы</div>`;
  }
  return `<div class="table-wrap"><table class="dash-table budget-matrix">
    <thead><tr><th>Срок \\ Статус</th>${statuses.map(s => `<th title="${escapeHtml(s)}">${escapeHtml(s)}</th>`).join("")}</tr></thead>
    <tbody>${periods.map(period => `<tr>
      <th scope="row" title="${escapeHtml(period)}">${escapeHtml(period)}</th>
      ${statuses.map(st => {
        const cnt = matrix[period]?.[st] || 0;
        const attrs = cnt ? drillRowAttrs(withDashboardFilters(buildDealsReportSpec({ budgetPeriod: [period], budgetStatus: [st] }))) : "";
        return `<td class="budget-matrix-cell${cnt ? " dash-drill-row has-data" : ""}" ${attrs} title="${cnt ? "Открыть сделки" : ""}">${cnt || "—"}</td>`;
      }).join("")}
    </tr>`).join("")}
    </tbody>
  </table></div>`;
}
