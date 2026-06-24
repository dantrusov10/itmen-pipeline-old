/* Drill-down: дашборд → таблица сделок + шаринг фильтров в URL */
const PILOT_STAGES = ["Подготовка Пилота", "Пилот", "Пилот Окончен"];

let dealsTablePreset = null;

function commitShortToLabel(short) {
  const c = (window.ITMEN_CONFIG?.commitStatuses || []).find(x => x.short === short);
  return c?.label || short;
}

function applyPresetFilter(rows, preset) {
  if (!preset?.type) return rows;
  switch (preset.type) {
    case "incomplete":
      return rows.filter(d => d.quality === "Неполный");
    case "risk":
      return rows.filter(d => d.riskFlag);
    case "pilot":
      return rows.filter(d => PILOT_STAGES.includes(d.stage));
    case "attention":
      return rows.filter(d =>
        d.quality === "Неполный" ||
        (d.daysTo != null && d.daysTo < 0) ||
        (d.category === "Горячая" && d.budgetStatus === "Нет бюджета") ||
        d.riskFlag
      );
    case "hotNoBudget":
      return rows.filter(d => d.category === "Горячая" && d.budgetStatus === "Нет бюджета");
    case "overdue":
      return rows.filter(d => d.daysTo != null && d.daysTo < 0);
    case "segment": {
      const seg = preset.value;
      if (!seg) return rows;
      const labels = Object.fromEntries((window.ITMEN_CONFIG?.techSegments || []).map(s => [s.id, s.label]));
      return rows.filter(d => (d.techResearch?.seekingSegments || []).some(s => {
        const label = s === "other"
          ? (d.techResearch?.seekingOtherLabel?.trim() || "Другое")
          : (labels[s] || s);
        return label === seg;
      }));
    }
    default:
      return rows;
  }
}

function buildDealsReportSpec(filters = {}, preset = null) {
  return { filters: { ...filters }, preset: preset ? { ...preset } : null };
}

function serializeDealsReportSpec(spec) {
  const params = new URLSearchParams();
  const filters = spec?.filters || {};
  Object.entries(filters).forEach(([key, val]) => {
    if (val == null || val === "") return;
    if (Array.isArray(val)) {
      if (val.length) params.set(key, val.join("|"));
    } else {
      params.set(key, String(val));
    }
  });
  if (spec?.preset?.type) {
    params.set("preset", spec.preset.type);
    if (spec.preset.value) params.set("presetValue", spec.preset.value);
  }
  const qs = params.toString();
  return qs ? `deals?${qs}` : "deals";
}

function parseLocationHash() {
  const raw = (location.hash || "").replace(/^#/, "");
  if (!raw) return { page: "panel", spec: null };
  const q = raw.indexOf("?");
  const page = q >= 0 ? raw.slice(0, q) : raw;
  const query = q >= 0 ? raw.slice(q + 1) : "";
  if (page !== "deals" || !query) return { page, spec: null };
  const params = new URLSearchParams(query);
  const filters = {};
  params.forEach((val, key) => {
    if (key === "preset" || key === "presetValue") return;
    if (key.endsWith("__from") || key.endsWith("__to")) {
      filters[key] = val;
      return;
    }
    filters[key] = val.includes("|") ? val.split("|") : val;
  });
  const presetType = params.get("preset");
  const preset = presetType
    ? { type: presetType, value: params.get("presetValue") || undefined }
    : null;
  return { page, spec: buildDealsReportSpec(filters, preset) };
}

function applyDealsReportSpec(spec) {
  dealsTableColFilters = {};
  dealsTablePreset = null;
  dealsTableSearch = "";
  if (!spec) return;

  const filters = spec.filters || {};
  Object.entries(filters).forEach(([key, val]) => {
    if (Array.isArray(val)) {
      if (val.length) dealsTableColFilters[key] = val;
    } else if (val !== "" && val != null) {
      dealsTableColFilters[key] = val;
    }
  });
  dealsTablePreset = spec.preset?.type ? { ...spec.preset } : null;
}

function syncDealsReportFiltersToUI() {
  const gs = document.getElementById("deals-global-search");
  if (gs) gs.value = dealsTableSearch || "";

  document.querySelectorAll("#deals-table .deals-col-filter").forEach(el => {
    const col = el.dataset.col;
    const bound = el.dataset.bound;
    if (bound) el.value = dealsTableColFilters[col + "__" + bound] || "";
    else el.value = dealsTableColFilters[col] || "";
  });

  document.querySelectorAll("#deals-table .deals-ms-filter").forEach(wrap => {
    const colKey = wrap.dataset.col;
    const selected = new Set(getMultiselectFilter(colKey));
    wrap.querySelectorAll(".deals-ms-cb").forEach(cb => {
      cb.checked = selected.has(cb.value);
    });
    updateMultiselectToggleLabel(colKey);
  });
}

function updateDealsReportHash(spec) {
  const hash = serializeDealsReportSpec(spec || buildDealsReportSpec(dealsTableColFilters, dealsTablePreset));
  if (location.hash.replace(/^#/, "") !== hash) {
    history.replaceState(null, "", "#" + hash);
  }
}

function openDealsReport(spec) {
  navigate("deals", spec);
}

function readMultiDataset(el, singleKey, multiKey) {
  if (el.dataset[multiKey]) return el.dataset[multiKey].split("|");
  if (el.dataset[singleKey]) return [el.dataset[singleKey]];
  return null;
}

function drillSpecFromElement(el) {
  if (el.dataset.drillPreset) {
    const spec = buildDealsReportSpec({}, { type: el.dataset.drillPreset, value: el.dataset.drillPresetValue });
    const cat = readMultiDataset(el, "drillCategory", "drillCategories");
    if (cat) spec.filters.category = cat;
    const owner = readMultiDataset(el, "drillOwner", "drillOwners");
    if (owner) spec.filters.owner = owner;
    const stage = readMultiDataset(el, "drillStage", "drillStages");
    if (stage) spec.filters.stage = stage;
    const bp = readMultiDataset(el, "drillBudgetPeriod", "drillBudgetPeriods");
    if (bp) spec.filters.budgetPeriod = bp;
    const bs = readMultiDataset(el, "drillBudgetStatus", "drillBudgetStatuses");
    if (bs) spec.filters.budgetStatus = bs;
    const cs = readMultiDataset(el, "drillCommitStatus", "drillCommitStatuses");
    if (cs) spec.filters.commitStatus = cs;
    if (el.dataset.drillScoreMin) spec.filters.score__from = el.dataset.drillScoreMin;
    return spec;
  }
  const filters = {};
  const cat = readMultiDataset(el, "drillCategory", "drillCategories");
  if (cat) filters.category = cat;
  const owner = readMultiDataset(el, "drillOwner", "drillOwners");
  if (owner) filters.owner = owner;
  const stage = readMultiDataset(el, "drillStage", "drillStages");
  if (stage) filters.stage = stage;
  const bp = readMultiDataset(el, "drillBudgetPeriod", "drillBudgetPeriods");
  if (bp) filters.budgetPeriod = bp;
  const bs = readMultiDataset(el, "drillBudgetStatus", "drillBudgetStatuses");
  if (bs) filters.budgetStatus = bs;
  const cs = readMultiDataset(el, "drillCommitStatus", "drillCommitStatuses");
  if (cs) filters.commitStatus = cs;
  if (el.dataset.drillScoreMin) filters.score__from = el.dataset.drillScoreMin;
  if (el.dataset.drillScoreMax) filters.score__to = el.dataset.drillScoreMax;
  if (el.dataset.drillCustomer) filters.customer = el.dataset.drillCustomer;
  return buildDealsReportSpec(filters, null);
}

function getDealsReportFilterSummary() {
  const parts = [];
  if (dealsTablePreset?.type) {
    const labels = {
      incomplete: "Неполные паспорта",
      risk: "Флаги риска",
      pilot: "На пилоте",
      attention: "Требуют внимания",
      hotNoBudget: "Горячие без бюджета",
      overdue: "Просроченные задачи",
      segment: `Сегмент: ${dealsTablePreset.value || ""}`,
    };
    parts.push(labels[dealsTablePreset.type] || dealsTablePreset.type);
  }
  DEALS_TABLE_COLS.forEach(col => {
    if (col.filter === "range") {
      const from = dealsTableColFilters[col.key + "__from"];
      const to = dealsTableColFilters[col.key + "__to"];
      if (from || to) parts.push(`${col.label}: ${from || "…"}–${to || "…"}`);
      return;
    }
    if (col.filter === "multiselect") {
      const sel = getMultiselectFilter(col.key);
      if (sel.length) parts.push(`${col.label}: ${sel.join(", ")}`);
      return;
    }
    const f = dealsTableColFilters[col.key];
    if (f) parts.push(`${col.label}: ${f}`);
  });
  return parts;
}

function copyDealsReportLink() {
  const spec = buildDealsReportSpec(dealsTableColFilters, dealsTablePreset);
  const url = `${location.origin}${location.pathname}#${serializeDealsReportSpec(spec)}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast("Ссылка на отчёт скопирована");
  }).catch(() => {
    prompt("Скопируйте ссылку:", url);
  });
}

function metricCardDrill(label, value, sub, drillAttrs = "") {
  return `<div class="metric-card${drillAttrs ? " metric-card--drill" : ""}"${drillAttrs} title="${drillAttrs ? "Открыть список сделок" : ""}">
    <div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

function drillRowAttrs(spec) {
  const el = document.createElement("div");
  if (spec.preset?.type) el.dataset.drillPreset = spec.preset.type;
  if (spec.preset?.value) el.dataset.drillPresetValue = spec.preset.value;
  const f = spec.filters || {};
  const setMulti = (attr, val) => {
    if (!val) return;
    const arr = Array.isArray(val) ? val : [val];
    if (arr.length === 1) el.dataset[attr] = arr[0];
    else if (arr.length > 1) el.dataset[attr + "s"] = arr.join("|");
  };
  setMulti("drillCategory", f.category);
  setMulti("drillOwner", f.owner);
  setMulti("drillStage", f.stage);
  setMulti("drillBudgetPeriod", f.budgetPeriod);
  setMulti("drillBudgetStatus", f.budgetStatus);
  setMulti("drillCommitStatus", f.commitStatus);
  if (f.score__from) el.dataset.drillScoreMin = f.score__from;
  if (f.score__to) el.dataset.drillScoreMax = f.score__to;
  if (f.customer) el.dataset.drillCustomer = f.customer;
  return [...el.attributes].map(a => `${a.name}="${escapeHtml(a.value)}"`).join(" ");
}
