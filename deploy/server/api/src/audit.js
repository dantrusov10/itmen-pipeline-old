"use strict";

const { createRecord } = require("./pb-client");

const FIELD_LABELS = {
  customer: "Клиент",
  industry: "Отрасль",
  owner: "Владелец",
  stage: "Стадия",
  amount: "Ожид. сумма",
  expectedBudget: "Ожид. бюджет",
  partner: "Партнёр",
  partnerDiscount: "Скидка партнёру, %",
  clientDiscount: "Скидка клиенту, %",
  manualProb: "Вероятность",
  taskDue: "Срок задачи",
  budgetPeriod: "Срок бюджета",
  budgetStatus: "Статус бюджета",
  budgetPlannedMonth: "Месяц согласования",
  budgetPlannedYear: "Год согласования",
  commitStatus: "Статус коммита",
  pains: "Ключевые боли",
  riskTypes: "Риски",
  riskComment: "Комментарий к риску",
  scores: "Скоринг",
  seekingSegments: "Что ищут",
  seekingOtherLabel: "Другое (что ищут)",
  productRequirementsPct: "% требований проекта",
  pilotRequirementsPct: "% требований пилота",
  asIsStack: "Что есть сейчас",
  changePains: "Почему меняют",
  competitorEntries: "Конкуренты",
  projectTasks: "Задачи проекта",
};

const SCALAR_FIELDS = [
  "customer", "industry", "owner", "stage", "amount", "expectedBudget",
  "partner", "partnerDiscount", "clientDiscount", "manualProb", "taskDue",
  "budgetPeriod", "budgetStatus", "budgetPlannedMonth", "budgetPlannedYear",
  "commitStatus", "pains", "riskComment",
];

const AUDIT_VALUE_MAX = 4000;

function normalizeRiskTypes(deal) {
  if (!deal) return [];
  if (deal.riskTypes?.length) return deal.riskTypes.filter(r => r && r !== "none");
  if (deal.riskType && deal.riskType !== "none") return [deal.riskType];
  return [];
}

function formatAuditValue(key, val) {
  if (val === null || val === undefined || val === "") return "";
  if (key === "riskTypes" || key === "seekingSegments") {
    return (Array.isArray(val) ? val : []).join(", ");
  }
  if (key === "projectTasks") {
    return (Array.isArray(val) ? val : []).join("; ");
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function truncate(s) {
  const str = s == null ? "" : String(s);
  return str.length <= AUDIT_VALUE_MAX ? str : `${str.slice(0, AUDIT_VALUE_MAX)}…`;
}

function diffDeal(oldD, newD) {
  const changes = [];
  for (const key of SCALAR_FIELDS) {
    const o = formatAuditValue(key, oldD?.[key]);
    const n = formatAuditValue(key, newD?.[key]);
    if (o !== n) changes.push({ field: key, label: FIELD_LABELS[key] || key, old: o, new: n });
  }

  const oRisks = formatAuditValue("riskTypes", normalizeRiskTypes(oldD));
  const nRisks = formatAuditValue("riskTypes", normalizeRiskTypes(newD));
  if (oRisks !== nRisks) {
    changes.push({ field: "riskTypes", label: FIELD_LABELS.riskTypes, old: oRisks, new: nRisks });
  }

  const oScores = JSON.stringify(oldD?.scores || {});
  const nScores = JSON.stringify(newD?.scores || {});
  if (oScores !== nScores) {
    changes.push({ field: "scores", label: FIELD_LABELS.scores, old: oScores, new: nScores });
  }

  const otr = oldD?.techResearch || {};
  const ntr = newD?.techResearch || {};
  const techKeys = [
    "seekingSegments", "seekingOtherLabel", "productRequirementsPct",
    "pilotRequirementsPct", "asIsStack", "changePains", "competitorEntries", "projectTasks",
  ];
  for (const key of techKeys) {
    const o = formatAuditValue(key, otr[key]);
    const n = formatAuditValue(key, ntr[key]);
    if (o !== n) changes.push({ field: key, label: FIELD_LABELS[key] || key, old: o, new: n });
  }
  return changes;
}

async function writeDealAudit({ savedBy, oldDeal, newDeal, isNew = false }) {
  const at = new Date().toISOString();
  const rows = [];

  if (isNew || !oldDeal) {
    rows.push({
      at,
      saved_by: savedBy,
      deal_id: newDeal.id,
      customer: newDeal.customer || "",
      owner: newDeal.owner || "",
      change_count: 1,
      label: "—",
      old_value: "",
      new_value: "Новая сделка",
      is_new_deal: true,
    });
  } else {
    const changes = diffDeal(oldDeal, newDeal);
    for (const ch of changes) {
      rows.push({
        at,
        saved_by: savedBy,
        deal_id: newDeal.id,
        customer: newDeal.customer || "",
        owner: newDeal.owner || "",
        change_count: changes.length,
        label: ch.label,
        old_value: truncate(ch.old),
        new_value: truncate(ch.new),
        is_new_deal: false,
      });
    }
  }

  for (const row of rows) {
    await createRecord("audit_log", row);
  }
  return rows.length;
}

module.exports = { diffDeal, writeDealAudit };
