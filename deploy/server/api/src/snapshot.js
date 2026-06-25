"use strict";

const { listAll, findOne, createRecord, deleteByFilter } = require("./pb-client");
const { loadPipelineState } = require("./mapper");
const { calcDealScore, calcCategory, isWeightedDeal, formatDateMsk } = require("./metrics");

async function takeDailySnapshot(source = "cron") {
  const today = formatDateMsk();
  const ts = new Date().toISOString();
  const state = await loadPipelineState({ lite: false });
  const deals = state.deals || [];

  await deleteByFilter("snapshots_daily", `date="${today}"`);
  const existingDealSnaps = await listAll("snapshots_deals", { filter: `date="${today}"` });
  for (const row of existingDealSnaps) {
    await require("./pb-client").deleteRecord("snapshots_deals", row.id);
  }

  let totalPipeline = 0;
  let weightedPipeline = 0;
  let hotCount = 0;
  let warmCount = 0;
  let scoreSum = 0;
  let scoreN = 0;

  for (const d of deals) {
    if (!d?.id) continue;
    const score = calcDealScore(d.scores) || 0;
    const category = calcCategory(score, d.commitStatus, d.budgetStatus);
    const amount = Number(d.amount) || 0;
    totalPipeline += amount;
    if (isWeightedDeal(score, category)) weightedPipeline += amount;
    if (category === "Горячая") hotCount += 1;
    if (category === "Тёплая") warmCount += 1;
    if (score > 0) { scoreSum += score; scoreN += 1; }

    await createRecord("snapshots_deals", {
      date: today,
      ts,
      deal_id: d.id,
      customer: d.customer || "",
      owner: d.owner || "",
      score,
      amount,
      category,
    });
  }

  const avgScore = scoreN ? Math.round(scoreSum / scoreN) : 0;
  await createRecord("snapshots_daily", {
    date: today,
    ts,
    source,
    deal_count: deals.length,
    total_pipeline: totalPipeline,
    weighted_pipeline: weightedPipeline,
    hot_count: hotCount,
    warm_count: warmCount,
    avg_score: avgScore,
  });

  return {
    ok: true,
    source,
    date: today,
    dealCount: deals.length,
    totalPipeline,
    weightedPipeline,
    avgScore,
  };
}

module.exports = { takeDailySnapshot };
