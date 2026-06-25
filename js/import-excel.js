/* Импорт Excel — 1 лист = 1 менеджер (фамилия) */
const EXCEL_COLS = [
  "Клиент", "Отрасль", "Стадия", "Ожидаемая сумма", "Ожидаемый бюджет",
  "Партнёр", "Скидка партнёру %", "Скидка клиенту %", "Плановый период бюджета",
  "Статус бюджета", "Месяц согласования", "Год согласования",
  "Что ищут", "As-IS", "Боли смены", "Конкуренты", "Ключевые задачи",
  "% продукта", "% пилота", "Срок задачи",
  "Критический риск", "Комментарий риск", "Общие боли",
  "Лояльность (0-5)", "Статус коммита",
];

function ownerFromSheet(sheetName) {
  const map = window.ITMEN_CONFIG?.managerSheetMap || {};
  if (map[sheetName]) return map[sheetName];
  for (const [k, v] of Object.entries(map)) {
    if (sheetName.includes(k)) return v;
  }
  return sheetName;
}

function rowToDeal(row, owner) {
  const customer = String(row["Клиент"] || "").trim();
  if (!customer) return null;

  const tr = techResearchFromImport(row);
  const commitStatus = row["Статус коммита"] || "none";
  const suggestion = suggestScores({
    techResearch: tr,
    budgetStatus: row["Статус бюджета"],
    stage: row["Стадия"],
    pains: row["Общие боли"],
    commitStatus,
  });

  const scores = { ...suggestion.scores };
  const scoreReasons = { ...suggestion.reasons };
  const scoresOverridden = {};

  const loyaltyRaw = row["Лояльность (0-5)"];
  if (loyaltyRaw !== "" && loyaltyRaw != null && !isNaN(+loyaltyRaw)) {
    scores.loyalty = Math.min(5, Math.max(0, +loyaltyRaw));
    scoreReasons.loyalty = "Ручная оценка из Excel";
    scoresOverridden.loyalty = true;
  } else {
    scores.loyalty = 0;
    scoreReasons.loyalty = "Оценивается только вручную";
  }

  const budgetStatus = row["Статус бюджета"] || "Неизвестно";
  return migrateDeal({
    id: "IMPORT",
    customer,
    industry: row["Отрасль"] || "Не определена",
    owner: owner,
    stage: row["Стадия"] || (state.lists?.stages?.[0] || "Взят в работу"),
    dealType: "Текущий пайплайн",
    amount: +row["Ожидаемая сумма"] || 0,
    expectedBudget: +row["Ожидаемый бюджет"] || 0,
    partner: row["Партнёр"] || "Нет партнёра",
    partnerDiscount: +row["Скидка партнёру %"] || 0,
    clientDiscount: +row["Скидка клиенту %"] || 0,
    manualProb: 0,
    taskDue: formatExcelDate(row["Срок задачи"]),
    budgetPeriod: row["Плановый период бюджета"] || "Не определён",
    budgetStatus,
    budgetPlannedMonth: budgetStatus === "Планируется согласование" ? (+row["Месяц согласования"] || null) : null,
    budgetPlannedYear: budgetStatus === "Планируется согласование" ? (+row["Год согласования"] || null) : null,
    pains: row["Общие боли"] || "",
    riskType: row["Критический риск"] || "none",
    riskComment: row["Комментарий риск"] || "",
    commitStatus,
    techResearch: tr,
    scores,
    scoreReasons,
    scoreHistory: [{ date: new Date().toISOString().slice(0, 10), source: "import", scores: { ...scores } }],
    scoresOverridden,
    lastUpdate: new Date().toISOString().slice(0, 10),
    amoId: null,
  });
}

function formatExcelDate(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function importExcelFile(file) {
  if (typeof XLSX === "undefined") {
    alert("Библиотека XLSX не загружена");
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    importExcelFromBuffer(e.target.result).catch(err => {
      console.error(err);
      alert("Ошибка импорта: " + err.message);
    });
  };
  reader.readAsArrayBuffer(file);
}

async function importExcelFromBuffer(buffer) {
  if (typeof isAdmin === "function" && !isAdmin()) {
    throw new Error("Импорт Excel доступен только администратору");
  }
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const skip = new Set(["Инструкция", "Справочники", "Instructions"]);
  let imported = 0;
  const newDeals = [];

  wb.SheetNames.forEach(sheetName => {
    if (skip.has(sheetName)) return;
    const owner = ownerFromSheet(sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    rows.forEach(row => {
      const deal = rowToDeal(row, owner);
      if (!deal) return;
      deal.id = consumeDealId();
      newDeals.push(deal);
      imported++;
    });
  });

  if (!imported) {
    alert("Не найдено строк с клиентами. Проверьте шаблон.");
    return;
  }
  if (!confirm(`Импортировать ${imported} сделок? Существующие не удаляются.`)) return;

  state.deals.push(...newDeals);
  await saveState({ forceFull: true });
  renderAll();
  showToast(`Импортировано ${imported} сделок`);
}
