/**
 * ITMen Pipeline — Google Apps Script API
 * Хранит JSON пайплайна в скрытом листе _pipeline (чанками по 40k символов).
 * Журнал изменений — лист _audit.
 *
 * Деплой: Развернуть → Веб-приложение → доступ «Все, в том числе анонимные».
 */

var STATE_SHEET = '_pipeline';
var AUDIT_SHEET = '_audit';
var CHUNK_SIZE = 40000;
var AUDIT_VALUE_MAX = 1500;

var MANAGERS = [
  { id: 'merlein', name: 'Аркадий Мерлейн', sheet: 'Мерлейн' },
  { id: 'akhmetshin', name: 'Арслан Ахметшин', sheet: 'Ахметшин' },
  { id: 'sirotkin', name: 'Александр Сироткин', sheet: 'Сироткин' },
  { id: 'kulagin', name: 'Алексей Кулагин', sheet: 'Кулагин' }
];

var FIELD_LABELS = {
  customer: 'Клиент',
  industry: 'Отрасль',
  owner: 'Владелец',
  stage: 'Стадия',
  amount: 'Ожид. сумма',
  expectedBudget: 'Ожид. бюджет',
  partner: 'Партнёр',
  partnerDiscount: 'Скидка партнёру, %',
  clientDiscount: 'Скидка клиенту, %',
  manualProb: 'Вероятность',
  taskDue: 'Срок задачи',
  budgetPeriod: 'Срок бюджета',
  budgetStatus: 'Статус бюджета',
  budgetPlannedMonth: 'Месяц согласования',
  budgetPlannedYear: 'Год согласования',
  commitStatus: 'Статус коммита',
  pains: 'Ключевые боли',
  riskTypes: 'Риски',
  riskComment: 'Комментарий к риску',
  scores: 'Скоринг',
  seekingSegments: 'Что ищут',
  seekingOtherLabel: 'Другое (что ищут)',
  productRequirementsPct: '% требований проекта',
  pilotRequirementsPct: '% требований пилота',
  asIsStack: 'Что есть сейчас',
  changePains: 'Почему меняют',
  competitorEntries: 'Конкуренты',
  projectTasks: 'Задачи проекта'
};

var SCALAR_FIELDS = [
  'customer', 'industry', 'owner', 'stage', 'amount', 'expectedBudget',
  'partner', 'partnerDiscount', 'clientDiscount', 'manualProb', 'taskDue',
  'budgetPeriod', 'budgetStatus', 'budgetPlannedMonth', 'budgetPlannedYear',
  'commitStatus', 'pains', 'riskComment'
];

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'get';
  try {
    if (action === 'health') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var auditSh = getAuditSheet_();
      var auditCount = Math.max(0, auditSh.getLastRow() - 1);
      return json_({
        ok: true,
        ts: new Date().toISOString(),
        auditSheet: AUDIT_SHEET,
        auditRows: auditCount,
        spreadsheetId: ss.getId(),
        spreadsheetName: ss.getName()
      });
    }
    if (action === 'audit' || action === 'auditAll') {
      if (action === 'auditAll') {
        return json_({ rows: readAllAuditRows_() });
      }
      var limit = Math.min(Math.max(+(e.parameter.limit || 10), 1), 5000);
      var auditSh = getAuditSheet_();
      var lastRow = auditSh.getLastRow();
      if (lastRow < 2) return json_({ rows: [] });
      var startRow = Math.max(2, lastRow - limit + 1);
      var numRows = lastRow - startRow + 1;
      return json_({
        rows: auditSh.getRange(startRow, 1, numRows, 9).getValues()
      });
    }
    if (action === 'init' || action === 'setup') {
      getStateSheet_();
      getAuditSheet_();
      return json_({ ok: true, auditSheet: AUDIT_SHEET, pipelineSheet: STATE_SHEET });
    }
    if (action === 'get' || action === 'pipeline') return json_({ state: loadState_() });
    if (action === 'managers') return json_(MANAGERS);
    return json_({ error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'recoverFromAudit') {
      return json_(recoverFromAudit_(!!body.apply, body.mode || 'lost'));
    }
    if (body.action === 'save') {
      if (!body.state || !Array.isArray(body.state.deals)) {
        return json_({ error: 'Некорректное тело запроса' });
      }
      var oldState = loadState_();
      getAuditSheet_();
      var savedBy = String(body.savedBy || '').trim();
      var editedDealIds = body.editedDealIds || [];
      var deletedDealIds = body.deletedDealIds || [];
      var mergeResult;
      var mergedState;
      if (body.forceFull) {
        mergedState = body.state;
        mergeResult = { conflicts: [], keptServer: 0, tookClient: 0 };
      } else {
        mergeResult = mergePipelineStates_(oldState, body.state, editedDealIds, deletedDealIds);
        mergedState = mergeResult.state;
      }
      var diffRows = diffPipeline_(oldState, mergedState);
      var auditWritten = appendAudit_(savedBy, diffRows);
      var updatedAt = saveState_(mergedState);
      return json_({
        ok: true,
        updatedAt: updatedAt,
        auditRows: auditWritten,
        state: loadState_(),
        conflicts: mergeResult.conflicts || [],
        mergeKeptServer: mergeResult.keptServer || 0,
        mergeTookClient: mergeResult.tookClient || 0
      });
    }
    return json_({ error: 'Unknown action' });
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getStateSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(STATE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STATE_SHEET);
    sh.hideSheet();
  }
  return sh;
}

function getAuditSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(AUDIT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_SHEET);
    sh.appendRow([
      'Когда', 'Кто сохранил', 'ID сделки', 'Клиент', 'Ответственный',
      'Изменений', 'Поле', 'Было', 'Стало'
    ]);
    sh.getRange(1, 1, 1, 9).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 9);
  }
  return sh;
}

function loadState_() {
  var sh = getStateSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 1) return null;
  var rows = sh.getRange(1, 1, lastRow, 1).getValues();
  var jsonStr = rows.map(function (r) { return r[0]; }).join('');
  if (!jsonStr) return null;
  return JSON.parse(jsonStr);
}

function saveState_(state) {
  var sh = getStateSheet_();
  var payload = JSON.parse(JSON.stringify(state));
  payload._savedAt = new Date().toISOString();
  payload._savedBy = 'web';
  var jsonStr = JSON.stringify(payload);
  var chunks = [];
  for (var i = 0; i < jsonStr.length; i += CHUNK_SIZE) {
    chunks.push([jsonStr.substring(i, i + CHUNK_SIZE)]);
  }
  if (chunks.length === 0) chunks.push(['']);
  sh.clear();
  sh.getRange(1, 1, chunks.length, 1).setValues(chunks);
  return payload._savedAt;
}

function normalizeRiskTypes_(deal) {
  if (!deal) return [];
  if (deal.riskTypes && deal.riskTypes.length) {
    return deal.riskTypes.filter(function (r) { return r && r !== 'none'; });
  }
  if (deal.riskType && deal.riskType !== 'none') return [deal.riskType];
  return [];
}

function formatAuditValue_(key, val) {
  if (val === null || val === undefined || val === '') return '';
  if (key === 'riskTypes') {
    var arr = Array.isArray(val) ? val : [];
    return arr.join(', ');
  }
  if (key === 'seekingSegments') {
    return (Array.isArray(val) ? val : []).join(', ');
  }
  if (key === 'projectTasks') {
    return (Array.isArray(val) ? val : []).join('; ');
  }
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function truncate_(s) {
  s = s == null ? '' : String(s);
  if (s.length <= AUDIT_VALUE_MAX) return s;
  return s.substring(0, AUDIT_VALUE_MAX) + '…';
}

function diffDeal_(oldD, newD) {
  var changes = [];
  var i, key, o, n;

  for (i = 0; i < SCALAR_FIELDS.length; i++) {
    key = SCALAR_FIELDS[i];
    o = formatAuditValue_(key, oldD[key]);
    n = formatAuditValue_(key, newD[key]);
    if (o !== n) {
      changes.push({ field: key, label: FIELD_LABELS[key] || key, old: o, new: n });
    }
  }

  o = formatAuditValue_('riskTypes', normalizeRiskTypes_(oldD));
  n = formatAuditValue_('riskTypes', normalizeRiskTypes_(newD));
  if (o !== n) {
    changes.push({ field: 'riskTypes', label: FIELD_LABELS.riskTypes, old: o, new: n });
  }

  o = JSON.stringify(oldD.scores || {});
  n = JSON.stringify(newD.scores || {});
  if (o !== n) {
    changes.push({ field: 'scores', label: FIELD_LABELS.scores, old: o, new: n });
  }

  var otr = oldD.techResearch || {};
  var ntr = newD.techResearch || {};
  var techKeys = [
    'seekingSegments', 'seekingOtherLabel', 'productRequirementsPct',
    'pilotRequirementsPct', 'asIsStack', 'changePains', 'competitorEntries', 'projectTasks'
  ];
  for (i = 0; i < techKeys.length; i++) {
    key = techKeys[i];
    o = formatAuditValue_(key, otr[key]);
    n = formatAuditValue_(key, ntr[key]);
    if (o !== n) {
      changes.push({ field: key, label: FIELD_LABELS[key] || key, old: o, new: n });
    }
  }

  return changes;
}

function diffPipeline_(oldState, newState) {
  var rows = [];
  var oldMap = {};
  var newMap = {};
  var id, od, nd, changes, j;

  (oldState && oldState.deals ? oldState.deals : []).forEach(function (d) {
    if (d && d.id) oldMap[d.id] = d;
  });
  (newState.deals || []).forEach(function (d) {
    if (d && d.id) newMap[d.id] = d;
  });

  Object.keys(newMap).forEach(function (dealId) {
    nd = newMap[dealId];
    od = oldMap[dealId];
    if (!od) {
      rows.push({
        dealId: dealId,
        customer: nd.customer || '',
        owner: nd.owner || '',
        changeCount: 1,
        label: '—',
        old: '',
        new: 'Новая сделка'
      });
      return;
    }
    changes = diffDeal_(od, nd);
    if (!changes.length) return;
    for (j = 0; j < changes.length; j++) {
      rows.push({
        dealId: dealId,
        customer: nd.customer || '',
        owner: nd.owner || '',
        changeCount: changes.length,
        label: changes[j].label,
        old: changes[j].old,
        new: changes[j].new
      });
    }
  });

  Object.keys(oldMap).forEach(function (dealId) {
    if (!newMap[dealId]) {
      od = oldMap[dealId];
      rows.push({
        dealId: dealId,
        customer: od.customer || '',
        owner: od.owner || '',
        changeCount: 1,
        label: '—',
        old: 'Сделка удалена',
        new: ''
      });
    }
  });

  return rows;
}

function appendAudit_(savedBy, diffRows) {
  if (!diffRows || !diffRows.length) return 0;
  var sh = getAuditSheet_();
  var at = new Date();
  var tz = Session.getScriptTimeZone() || 'Europe/Moscow';
  var atStr = Utilities.formatDate(at, tz, 'yyyy-MM-dd HH:mm:ss');
  var startRow = sh.getLastRow() + 1;
  var data = diffRows.map(function (r) {
    var actor = r.owner || savedBy || '';
    return [
      atStr,
      actor,
      r.dealId || '',
      r.customer || '',
      r.owner || '',
      r.changeCount || 0,
      r.label || '',
      truncate_(r.old),
      truncate_(r.new)
    ];
  });
  sh.getRange(startRow, 1, data.length, 9).setValues(data);
  return data.length;
}

var LABEL_TO_KEY_ = {};
(function () {
  var k;
  for (k in FIELD_LABELS) {
    if (FIELD_LABELS.hasOwnProperty(k)) LABEL_TO_KEY_[FIELD_LABELS[k]] = k;
  }
})();

var TECH_AUDIT_KEYS_ = {
  seekingSegments: true, seekingOtherLabel: true, productRequirementsPct: true,
  pilotRequirementsPct: true, asIsStack: true, changePains: true,
  competitorEntries: true, projectTasks: true
};

function dealRevision_(deal) {
  if (!deal) return 0;
  if (deal.updatedAt) {
    var t = Date.parse(deal.updatedAt);
    if (!isNaN(t)) return t;
  }
  if (deal.lastUpdate) {
    var d = Date.parse(String(deal.lastUpdate) + 'T12:00:00.000Z');
    if (!isNaN(d)) return d;
  }
  return 0;
}

function cloneDeal_(deal) {
  return JSON.parse(JSON.stringify(deal));
}

function pickDealRevision_(serverDeal, clientDeal, editedDealIds, dealId) {
  var conflict = false;
  if (!serverDeal) return { deal: cloneDeal_(clientDeal), source: 'client', conflict: false };
  if (!clientDeal) return { deal: cloneDeal_(serverDeal), source: 'server', conflict: false };

  var serverRev = dealRevision_(serverDeal);
  var clientRev = dealRevision_(clientDeal);
  var edited = editedDealIds.indexOf(dealId) >= 0;

  if (edited && clientRev >= serverRev) {
    return { deal: cloneDeal_(clientDeal), source: 'client', conflict: false };
  }
  if (edited && clientRev < serverRev) {
    return { deal: cloneDeal_(serverDeal), source: 'server', conflict: true };
  }
  if (clientRev > serverRev) {
    return { deal: cloneDeal_(clientDeal), source: 'client', conflict: false };
  }
  return { deal: cloneDeal_(serverDeal), source: 'server', conflict: false };
}

function mergePipelineStates_(serverState, clientState, editedDealIds, deletedDealIds) {
  serverState = serverState || { deals: [] };
  clientState = clientState || { deals: [] };
  editedDealIds = editedDealIds || [];
  deletedDealIds = deletedDealIds || [];

  var serverMap = {};
  var clientMap = {};
  (serverState.deals || []).forEach(function (d) {
    if (d && d.id) serverMap[d.id] = d;
  });
  (clientState.deals || []).forEach(function (d) {
    if (d && d.id) clientMap[d.id] = d;
  });

  var deletedSet = {};
  deletedDealIds.forEach(function (id) { deletedSet[id] = true; });

  var conflicts = [];
  var keptServer = 0;
  var tookClient = 0;
  var mergedMap = {};
  var allIds = {};

  Object.keys(serverMap).forEach(function (id) { allIds[id] = true; });
  Object.keys(clientMap).forEach(function (id) { allIds[id] = true; });

  Object.keys(allIds).forEach(function (id) {
    if (deletedSet[id]) return;
    if (!clientMap[id] && serverMap[id]) {
      mergedMap[id] = cloneDeal_(serverMap[id]);
      keptServer++;
      return;
    }
    if (clientMap[id] && !serverMap[id]) {
      mergedMap[id] = cloneDeal_(clientMap[id]);
      tookClient++;
      return;
    }
    var picked = pickDealRevision_(serverMap[id], clientMap[id], editedDealIds, id);
    mergedMap[id] = picked.deal;
    if (picked.conflict) conflicts.push(id);
    if (picked.source === 'server') keptServer++;
    else tookClient++;
  });

  var order = (clientState.deals || []).map(function (d) { return d.id; }).filter(Boolean);
  (serverState.deals || []).forEach(function (d) {
    if (d.id && order.indexOf(d.id) < 0 && !deletedSet[d.id]) order.push(d.id);
  });

  var mergedDeals = order.map(function (id) { return mergedMap[id]; }).filter(Boolean);
  var merged = JSON.parse(JSON.stringify(clientState));
  merged.deals = mergedDeals;

  var serverSaved = Date.parse(serverState._savedAt || '') || 0;
  var clientSaved = Date.parse(clientState._savedAt || '') || 0;
  if (serverSaved > clientSaved) {
    if (serverState.lists) merged.lists = serverState.lists;
    if (serverState.nextId) merged.nextId = serverState.nextId;
  }

  return { state: merged, conflicts: conflicts, keptServer: keptServer, tookClient: tookClient };
}

function readAllAuditRows_() {
  var sh = getAuditSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var numRows = lastRow - 1;
  return sh.getRange(2, 1, numRows, 9).getValues();
}

function parseAuditValueToField_(key, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  var s = String(raw);
  if (key === 'scores' || key === 'asIsStack' || key === 'changePains' || key === 'competitorEntries') {
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  if (key === 'riskTypes' || key === 'seekingSegments') {
    return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  if (key === 'projectTasks') {
    return s.split(';').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  if (key === 'amount' || key === 'expectedBudget' || key === 'manualProb' ||
      key === 'partnerDiscount' || key === 'clientDiscount' ||
      key === 'budgetPlannedMonth' || key === 'budgetPlannedYear' ||
      key === 'productRequirementsPct' || key === 'pilotRequirementsPct') {
    var n = Number(s);
    return isNaN(n) ? null : n;
  }
  if (key === 'taskDue') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Europe/Moscow', 'yyyy-MM-dd');
    }
    return s;
  }
  return s;
}

function applyAuditFieldToDeal_(deal, label, rawValue) {
  var key = LABEL_TO_KEY_[label];
  if (!key || rawValue === null || rawValue === undefined || rawValue === '') return false;
  var val = parseAuditValueToField_(key, rawValue);
  if (val === null && key !== 'pains' && key !== 'riskComment' && key !== 'taskDue') return false;

  if (TECH_AUDIT_KEYS_[key]) {
    if (!deal.techResearch) deal.techResearch = {};
    deal.techResearch[key] = val;
    return true;
  }
  if (key === 'riskTypes') {
    deal.riskTypes = val || [];
    deal.riskType = deal.riskTypes[0] || 'none';
    return true;
  }
  deal[key] = val;
  return true;
}

function isEmptyAuditField_(label, raw) {
  if (raw === null || raw === undefined) return true;
  var s = String(raw).trim();
  if (!s) return true;
  if (label === 'Статус бюджета' && s === 'Неизвестно') return true;
  if (label === 'Статус коммита' && (s === 'none' || s === 'Нет подтверждения')) return true;
  if (label === 'Срок бюджета' && s === 'Не определён') return true;
  if (label === 'Ключевые боли' && s.length < 5) return true;
  if (label === 'Скоринг') {
    try {
      var sc = JSON.parse(s);
      var sum = 0;
      var k;
      for (k in sc) if (sc.hasOwnProperty(k)) sum += (sc[k] || 0);
      return sum <= 2;
    } catch (e) { return true; }
  }
  if (label === 'Риски' || label === 'Что ищут') return s.length < 2;
  if (label === 'Что есть сейчас' || label === 'Почему меняют' || label === 'Конкуренты') {
    return s === '{}' || s === '';
  }
  return false;
}

function formatDealFieldForAudit_(deal, label) {
  var key = LABEL_TO_KEY_[label];
  if (!key) return '';
  if (TECH_AUDIT_KEYS_[key]) {
    return formatAuditValue_(key, (deal.techResearch || {})[key]);
  }
  if (key === 'riskTypes') {
    return formatAuditValue_('riskTypes', normalizeRiskTypes_(deal));
  }
  if (key === 'scores') {
    return JSON.stringify(deal.scores || {});
  }
  return formatAuditValue_(key, deal[key]);
}

function buildLostRecoverPlan_(rows, dealMap) {
  var timeline = {};
  var i, row, dealId, label, k, vals, lastGood, j, finalAudit, wasWiped, deal, currentFmt;
  for (i = 0; i < rows.length; i++) {
    row = rows[i];
    dealId = String(row[2] || '');
    label = String(row[6] || '');
    if (!dealId || !label || label === '—') continue;
    k = dealId + '\t' + label;
    if (!timeline[k]) timeline[k] = [];
    timeline[k].push(row[8]);
  }
  var plan = [];
  for (k in timeline) {
    if (!timeline.hasOwnProperty(k)) continue;
    vals = timeline[k];
    dealId = k.split('\t')[0];
    label = k.split('\t')[1];
    lastGood = null;
    for (j = 0; j < vals.length; j++) {
      if (!isEmptyAuditField_(label, vals[j])) lastGood = vals[j];
    }
    if (!lastGood) continue;
    finalAudit = vals[vals.length - 1];
    wasWiped = isEmptyAuditField_(label, finalAudit) && !isEmptyAuditField_(label, lastGood);
    deal = dealMap[dealId];
    if (!deal) continue;
    currentFmt = formatDealFieldForAudit_(deal, label);
    if (currentFmt === String(lastGood)) continue;
    if (wasWiped || (isEmptyAuditField_(label, currentFmt) && !isEmptyAuditField_(label, lastGood))) {
      plan.push({
        dealId: dealId,
        customer: deal.customer || '',
        label: label,
        value: lastGood,
        reason: wasWiped ? 'wiped_in_audit' : 'empty_on_server'
      });
    }
  }
  return plan;
}

function recoverFromAudit_(apply, mode) {
  mode = mode || 'lost';
  var rows = readAllAuditRows_();
  var current = loadState_() || { deals: [] };
  var dealMap = {};
  current.deals.forEach(function (d) {
    if (d && d.id) dealMap[d.id] = cloneDeal_(d);
  });

  var patches = 0;
  var plan = [];

  if (mode === 'lost') {
    plan = buildLostRecoverPlan_(rows, dealMap);
    plan.forEach(function (p) {
      if (applyAuditFieldToDeal_(dealMap[p.dealId], p.label, p.value)) patches++;
    });
  } else {
    rows.forEach(function (row) {
      var dealId = String(row[2] || '');
      var label = String(row[6] || '');
      var newVal = row[8];
      if (!dealId || !label || label === '—') return;
      if (!dealMap[dealId]) {
        dealMap[dealId] = { id: dealId, customer: String(row[3] || ''), owner: String(row[5] || '') };
      }
      if (applyAuditFieldToDeal_(dealMap[dealId], label, newVal)) patches++;
    });
  }

  var recovered = JSON.parse(JSON.stringify(current));
  recovered.deals = current.deals.map(function (d) {
    return dealMap[d.id] ? dealMap[d.id] : d;
  });

  var diffRows = diffPipeline_(current, recovered);
  if (apply) {
    getAuditSheet_();
    appendAudit_('recover', diffRows);
    var updatedAt = saveState_(recovered);
    return {
      ok: true,
      applied: true,
      mode: mode,
      patches: patches,
      plan: plan,
      auditRows: diffRows.length,
      changes: diffRows.length,
      updatedAt: updatedAt,
      state: loadState_()
    };
  }
  return {
    ok: true,
    applied: false,
    mode: mode,
    patches: patches,
    plan: plan,
    changes: diffRows.length,
    preview: diffRows.slice(0, 40)
  };
}

/** Запустите один раз из редактора Apps Script для инициализации */
function setup() {
  getStateSheet_();
  getAuditSheet_();
  Logger.log('Листы _pipeline и _audit готовы. Теперь: Развернуть → Веб-приложение.');
}
