"use strict";

const SCORE_WEIGHTS = {
  loyalty: 0.10, commit: 0.10, budget: 0.18, fit: 0.18, timing: 0.14,
  competitive: 0.10, access: 0.08, technical: 0.06, commercial: 0.06,
};

function calcDealScore(scores) {
  const vals = Object.values(scores || {});
  if (!vals.some(v => v > 0)) return null;
  let sum = 0;
  for (const [k, w] of Object.entries(SCORE_WEIGHTS)) sum += (scores[k] || 0) * w;
  return Math.round((sum / 5) * 100);
}

function calcCategory(score, commitStatus, budgetStatus) {
  const commit = commitStatus || "none";
  if (score == null && commit !== "contract") return "";
  if (commit === "contract") return "Горячая";
  if (budgetStatus === "Нет бюджета") {
    if (score >= 60) return "Тёплая";
    if (score >= 40) return "Наблюдение";
    return "Отказ";
  }
  if (score >= 80) return "Горячая";
  if (score >= 60) return "Тёплая";
  if (score >= 40) return "Наблюдение";
  return "Отказ";
}

function isWeightedDeal(score, category) {
  return score != null && score >= 60 && category !== "Отказ";
}

function formatDateMsk(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(d);
}

module.exports = { calcDealScore, calcCategory, isWeightedDeal, formatDateMsk };
