"use strict";

function dealRevision(deal) {
  if (!deal) return 0;
  if (deal.updatedAt) {
    const t = Date.parse(deal.updatedAt);
    if (!Number.isNaN(t)) return t;
  }
  if (deal.lastUpdate) {
    const d = Date.parse(`${deal.lastUpdate}T12:00:00.000Z`);
    if (!Number.isNaN(d)) return d;
  }
  return 0;
}

function cloneDeal(deal) {
  return JSON.parse(JSON.stringify(deal));
}

function pickDealRevision(serverDeal, clientDeal, editedDealIds, dealId) {
  if (!serverDeal) return { deal: cloneDeal(clientDeal), source: "client", conflict: false };
  if (!clientDeal) return { deal: cloneDeal(serverDeal), source: "server", conflict: false };

  const serverRev = dealRevision(serverDeal);
  const clientRev = dealRevision(clientDeal);
  const edited = editedDealIds.includes(dealId);

  if (edited && clientRev >= serverRev) {
    return { deal: cloneDeal(clientDeal), source: "client", conflict: false };
  }
  if (edited && clientRev < serverRev) {
    return { deal: cloneDeal(serverDeal), source: "server", conflict: true };
  }
  if (clientRev > serverRev) {
    return { deal: cloneDeal(clientDeal), source: "client", conflict: false };
  }
  return { deal: cloneDeal(serverDeal), source: "server", conflict: false };
}

function mergePipelineStates(serverState, clientState, editedDealIds = [], deletedDealIds = []) {
  serverState = serverState || { deals: [] };
  clientState = clientState || { deals: [] };

  const serverMap = Object.fromEntries((serverState.deals || []).filter(d => d?.id).map(d => [d.id, d]));
  const clientMap = Object.fromEntries((clientState.deals || []).filter(d => d?.id).map(d => [d.id, d]));
  const deletedSet = new Set(deletedDealIds);

  const conflicts = [];
  let keptServer = 0;
  let tookClient = 0;
  const mergedMap = {};
  const allIds = new Set([...Object.keys(serverMap), ...Object.keys(clientMap)]);

  for (const id of allIds) {
    if (deletedSet.has(id)) continue;
    if (!clientMap[id] && serverMap[id]) {
      mergedMap[id] = cloneDeal(serverMap[id]);
      keptServer += 1;
      continue;
    }
    if (clientMap[id] && !serverMap[id]) {
      mergedMap[id] = cloneDeal(clientMap[id]);
      tookClient += 1;
      continue;
    }
    const picked = pickDealRevision(serverMap[id], clientMap[id], editedDealIds, id);
    mergedMap[id] = picked.deal;
    if (picked.conflict) conflicts.push(id);
    if (picked.source === "server") keptServer += 1;
    else tookClient += 1;
  }

  const order = (clientState.deals || []).map(d => d.id).filter(Boolean);
  for (const d of serverState.deals || []) {
    if (d?.id && !order.includes(d.id) && !deletedSet.has(d.id)) order.push(d.id);
  }

  const merged = JSON.parse(JSON.stringify(clientState));
  merged.deals = order.map(id => mergedMap[id]).filter(Boolean);

  const serverSaved = Date.parse(serverState._savedAt || "") || 0;
  const clientSaved = Date.parse(clientState._savedAt || "") || 0;
  if (serverSaved > clientSaved) {
    if (serverState.lists) merged.lists = serverState.lists;
    if (serverState.nextId) merged.nextId = serverState.nextId;
  }

  return { state: merged, conflicts, keptServer, tookClient };
}

module.exports = { mergePipelineStates, dealRevision };
