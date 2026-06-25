"use strict";

const { listAll } = require("./pb-client");
const { loadPipelineState } = require("./mapper");
const { calcDealScore, calcCategory, isWeightedDeal, formatDateMsk } = require("./metrics");

function periodDays(period) {
  if (period === "month") return 30;
  if (period === "quarter") return 90;
  return 7;
}

function parseAuditScore(raw) {
  try {
    const sc = typeof raw === "string" ? JSON.parse(raw) : raw;
    return calcDealScore(sc);
  } catch {
    return null;
  }
}

function buildAuditScoreTimeline(rows) {
  const timeline = {};
  for (const row of rows) {
    if (row.label !== "Скоринг") continue;
    const dealId = row.deal_id || "";
    if (!dealId) continue;
    const when = row.at ? new Date(row.at) : null;
    if (!when || Number.isNaN(when.getTime())) continue;
    const score = parseAuditScore(row.new_value);
    if (score == null) continue;
    if (!timeline[dealId]) timeline[dealId] = [];
    timeline[dealId].push({
      when,
      score,
      customer: row.customer || "",
      owner: row.owner || "",
    });
  }
  for (const id of Object.keys(timeline)) {
    timeline[id].sort((a, b) => a.when - b.when);
  }
  return timeline;
}

function scoreAtOrBefore(timeline, dealId, cutoff) {
  const entries = timeline[dealId];
  if (!entries?.length) return null;
  let found = null;
  for (const e of entries) {
    if (e.when <= cutoff) found = e;
    else break;
  }
  return found;
}

async function readSnapshotDailySince(fromDateStr) {
  const rows = await listAll("snapshots_daily", { sort: "date" });
  return rows
    .filter(r => String(r.date) >= fromDateStr)
    .map(r => ({
      date: String(r.date),
      ts: r.ts,
      dealCount: r.deal_count || 0,
      totalPipeline: r.total_pipeline || 0,
      weightedPipeline: r.weighted_pipeline || 0,
      hotCount: r.hot_count || 0,
      warmCount: r.warm_count || 0,
      avgScore: r.avg_score || 0,
    }));
}

async function readDealSnapshotsForDate(dateStr) {
  const rows = await listAll("snapshots_deals", { filter: `date="${dateStr}"` });
  const map = {};
  for (const r of rows) {
    map[r.deal_id] = {
      dealId: r.deal_id,
      customer: r.customer || "",
      owner: r.owner || "",
      score: r.score || 0,
      amount: r.amount || 0,
      category: r.category || "",
    };
  }
  return map;
}

async function getDynamics(period = "week") {
  const days = periodDays(period);
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  const fromStr = formatDateMsk(from);

  const state = await loadPipelineState({ lite: false });
  const daily = await readSnapshotDailySince(fromStr);
  const baselineDate = daily.length ? daily[0].date : null;
  const baselineDeals = baselineDate ? await readDealSnapshotsForDate(baselineDate) : {};

  const auditRows = await listAll("audit_log");
  const auditTimeline = buildAuditScoreTimeline(auditRows);

  const deltas = [];
  for (const d of state.deals || []) {
    if (!d?.id) continue;
    const curScore = calcDealScore(d.scores);
    if (curScore == null) continue;
    const base = baselineDeals[d.id];
    let baseScore = base ? base.score : null;
    let meta = base || {};
    if (baseScore == null) {
      const auditBase = scoreAtOrBefore(auditTimeline, d.id, from);
      if (auditBase) {
        baseScore = auditBase.score;
        meta = auditBase;
      }
    }
    if (baseScore == null) continue;
    const delta = curScore - baseScore;
    if (delta === 0) continue;
    deltas.push({
      dealId: d.id,
      customer: d.customer || meta.customer || "",
      owner: d.owner || meta.owner || "",
      was: baseScore,
      now: curScore,
      delta,
      amount: Number(d.amount) || 0,
    });
  }

  deltas.sort((a, b) => b.delta - a.delta);
  const gains = deltas.filter(d => d.delta > 0).slice(0, 10);
  const losses = deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);

  const curTotals = { dealCount: 0, totalPipeline: 0, weightedPipeline: 0, avgScore: 0, hotCount: 0 };
  let scSum = 0;
  let scN = 0;
  for (const d of state.deals || []) {
    if (!d) continue;
    curTotals.dealCount += 1;
    const amount = Number(d.amount) || 0;
    const score = calcDealScore(d.scores) || 0;
    const category = calcCategory(score, d.commitStatus, d.budgetStatus);
    curTotals.totalPipeline += amount;
    if (isWeightedDeal(score, category)) curTotals.weightedPipeline += amount;
    if (category === "Горячая") curTotals.hotCount += 1;
    if (score > 0) { scSum += score; scN += 1; }
  }
  curTotals.avgScore = scN ? Math.round(scSum / scN) : 0;

  const first = daily[0] || null;
  const last = daily.length ? daily[daily.length - 1] : null;
  const summary = {
    pipelineDelta: last ? curTotals.totalPipeline - last.totalPipeline : (first ? curTotals.totalPipeline - first.totalPipeline : 0),
    weightedDelta: last ? curTotals.weightedPipeline - last.weightedPipeline : (first ? curTotals.weightedPipeline - first.weightedPipeline : 0),
    avgScoreDelta: last ? curTotals.avgScore - last.avgScore : (first ? curTotals.avgScore - first.avgScore : 0),
    dealCountDelta: last ? curTotals.dealCount - last.dealCount : (first ? curTotals.dealCount - first.dealCount : 0),
    baselineDate,
    snapshotDays: daily.length,
  };

  const trend = [...daily];
  trend.push({
    date: formatDateMsk(now),
    dealCount: curTotals.dealCount,
    totalPipeline: curTotals.totalPipeline,
    weightedPipeline: curTotals.weightedPipeline,
    hotCount: curTotals.hotCount,
    warmCount: 0,
    avgScore: curTotals.avgScore,
    live: true,
  });

  const allSnaps = await readSnapshotDailySince("2000-01-01");

  return {
    ok: true,
    period,
    days,
    from: fromStr,
    pipelineTrend: trend,
    summary,
    topGains: gains,
    topLosses: losses,
    hasSnapshots: allSnaps.length > 0,
    snapshotDays: daily.length,
  };
}

module.exports = { getDynamics };
