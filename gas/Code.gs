/**
 * ITMen Pipeline — Google Apps Script API
 * Хранит JSON пайплайна в скрытом листе _pipeline (чанками по 40k символов).
 * Журнал изменений — лист _audit.
 *
 * Деплой: Развернуть → Веб-приложение → доступ «Все, в том числе анонимные».
 */

var STATE_SHEET = '_pipeline';
var AUDIT_SHEET = '_audit';
var SNAPSHOT_DAILY_SHEET = '_snapshots_daily';
var SNAPSHOT_DEALS_SHEET = '_snapshots_deals';
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
    if (action === 'dynamics') {
      var period = String((e.parameter && e.parameter.period) || 'week');
      return json_(getDynamics_(period));
    }
    if (action === 'snapshotNow') {
      return json_(takeDailySnapshot_('manual'));
    }
    if (action === 'init' || action === 'setup') {
      getStateSheet_();
      getAuditSheet_();
      return json_({ ok: true, auditSheet: AUDIT_SHEET, pipelineSheet: STATE_SHEET });
    }
    if (action === 'getLite') return json_({ state: loadStateLite_() });
    if (action === 'getDeal') {
      var dealId = String((e.parameter && e.parameter.dealId) || '');
      if (!dealId) return json_({ error: 'dealId required' });
      return json_({ deal: getDealById_(dealId) });
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
    if (body.action === 'recoverSelective') {
      return json_(recoverSelective_(!!body.apply, body.approved || null));
    }
    if (body.action === 'recoverFromAudit') {
      return json_(recoverFromAudit_(!!body.apply, body.mode || 'lost'));
    }
    if (body.action === 'rollbackAuditBurst') {
      return json_(rollbackAuditBurst_(String(body.at || ''), !!body.apply));
    }
    if (body.action === 'setMaintenance') {
      var on = !!body.on;
      if (on) PropertiesService.getScriptProperties().setProperty('MAINTENANCE_MODE', '1');
      else PropertiesService.getScriptProperties().deleteProperty('MAINTENANCE_MODE');
      return json_({ ok: true, maintenanceMode: on });
    }
    if (body.action === 'save') {
      var maint = PropertiesService.getScriptProperties().getProperty('MAINTENANCE_MODE');
      if (maint === '1' && !body.allowMaintenance) {
        return json_({ error: 'Сохранение временно заблокировано (режим восстановления). Закройте все вкладки пайплайна и повторите загрузку с сервера.' });
      }
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
        var oldCount = (oldState && oldState.deals) ? oldState.deals.length : 0;
        var newCount = body.state.deals.length;
        if (oldCount >= 10 && newCount < Math.max(5, Math.floor(oldCount * 0.5))) {
          return json_({
            error: 'Отклонено: в сохранении слишком мало сделок (' + newCount + ' из ' + oldCount + ' на сервере). ' +
              'Загрузите актуальные данные с сервера или используйте обычное сохранение без forceFull.'
          });
        }
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

var PIPELINE_LITE_CACHE_KEY = 'pipeline_lite_v1';

function getPipelineCache_() {
  return CacheService.getScriptCache();
}

function invalidatePipelineCache_() {
  getPipelineCache_().remove(PIPELINE_LITE_CACHE_KEY);
}

function stripDealLite_(d) {
  var copy = JSON.parse(JSON.stringify(d));
  if (copy.pains && String(copy.pains).trim()) copy.hasPains = true;
  delete copy.pains;
  delete copy.riskComment;
  if (copy.techResearch) {
    var tr = copy.techResearch;
    copy.techResearch = {
      seekingSegments: tr.seekingSegments || [],
      seekingOtherLabel: tr.seekingOtherLabel || '',
      productRequirementsPct: tr.productRequirementsPct,
      pilotRequirementsPct: tr.pilotRequirementsPct
    };
  }
  copy._lite = true;
  return copy;
}

function toLiteState_(state) {
  if (!state) return null;
  var copy = JSON.parse(JSON.stringify(state));
  if (copy.deals) copy.deals = copy.deals.map(stripDealLite_);
  return copy;
}

function loadStateLite_() {
  var cache = getPipelineCache_();
  var cached = cache.get(PIPELINE_LITE_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  var full = loadState_();
  if (!full) return null;
  var lite = toLiteState_(full);
  var json = JSON.stringify(lite);
  if (json.length < 95000) cache.put(PIPELINE_LITE_CACHE_KEY, json, 300);
  return lite;
}

function getDealById_(dealId) {
  var state = loadState_();
  if (!state || !state.deals) return null;
  for (var i = 0; i < state.deals.length; i++) {
    if (state.deals[i].id === dealId) return state.deals[i];
  }
  return null;
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
  invalidatePipelineCache_();
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

var SELECTIVE_EXCLUDE_DEALS_ = { 'D-026': true };
var SELECTIVE_MIN_SCORE_SKIP_ = 20;

function calcDisplayScore_(deal) {
  var scores = (deal && deal.scores) ? deal.scores : {};
  var weights = {
    loyalty: 0.10, commit: 0.10, budget: 0.18, fit: 0.18, timing: 0.14,
    competitive: 0.10, access: 0.08, technical: 0.06, commercial: 0.06
  };
  var hasPos = false;
  var wsum = 0;
  var k;
  for (k in weights) {
    if ((scores[k] || 0) > 0) hasPos = true;
    wsum += (scores[k] || 0) * weights[k];
  }
  if (!hasPos) return 0;
  return Math.round((wsum / 5) * 100);
}

function buildSelectiveRecoverPlan_(rows, dealMap) {
  var timeline = {};
  var i, row, dealId, label, k, vals, lastGood, j, deal, currentFmt;
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
    if (SELECTIVE_EXCLUDE_DEALS_[dealId]) continue;
    deal = dealMap[dealId];
    if (!deal) continue;
    if (calcDisplayScore_(deal) >= SELECTIVE_MIN_SCORE_SKIP_) continue;

    lastGood = null;
    for (j = 0; j < vals.length; j++) {
      if (!isEmptyAuditField_(label, vals[j])) lastGood = vals[j];
    }
    if (!lastGood) continue;

    currentFmt = formatDealFieldForAudit_(deal, label);
    if (!isEmptyAuditField_(label, currentFmt)) continue;
    if (currentFmt === String(lastGood)) continue;

    plan.push({
      key: dealId + '|' + label,
      dealId: dealId,
      customer: deal.customer || '',
      owner: deal.owner || '',
      label: label,
      current: truncate_(currentFmt),
      value: lastGood,
      restore: truncate_(String(lastGood)),
      reason: 'empty_field'
    });
  }
  return plan;
}

function recoverSelective_(apply, approvedKeys) {
  var rows = readAllAuditRows_();
  var current = loadState_() || { deals: [] };
  var dealMap = {};
  current.deals.forEach(function (d) {
    if (d && d.id) dealMap[d.id] = cloneDeal_(d);
  });

  var plan = buildSelectiveRecoverPlan_(rows, dealMap);
  if (approvedKeys && approvedKeys.length) {
    var allow = {};
    approvedKeys.forEach(function (key) { allow[String(key)] = true; });
    plan = plan.filter(function (p) { return allow[p.key]; });
  }

  var patches = 0;
  if (apply) {
    plan.forEach(function (p) {
      if (applyAuditFieldToDeal_(dealMap[p.dealId], p.label, p.value)) patches++;
    });
  }

  var recovered = JSON.parse(JSON.stringify(current));
  recovered.deals = current.deals.map(function (d) {
    return dealMap[d.id] ? dealMap[d.id] : d;
  });

  var diffRows = diffPipeline_(current, recovered);
  var skippedHighScore = 0;
  var skippedExcluded = 0;
  Object.keys(dealMap).forEach(function (id) {
    if (SELECTIVE_EXCLUDE_DEALS_[id]) skippedExcluded++;
    else if (calcDisplayScore_(dealMap[id]) >= SELECTIVE_MIN_SCORE_SKIP_) skippedHighScore++;
  });

  if (apply) {
    getAuditSheet_();
    appendAudit_('recover-selective', diffRows);
    var updatedAt = saveState_(recovered);
    return {
      ok: true,
      applied: true,
      patches: patches,
      plan: plan,
      auditRows: diffRows.length,
      changes: diffRows.length,
      updatedAt: updatedAt
    };
  }
  return {
    ok: true,
    applied: false,
    patches: plan.length,
    plan: plan,
    changes: diffRows.length,
    rules: {
      excludeDeals: ['D-026'],
      skipDealsWithScoreGte: SELECTIVE_MIN_SCORE_SKIP_,
      onlyEmptyFields: true
    }
  };
}

function parseAuditTimestamp_(raw) {
  if (!raw) return '';
  var s = String(raw);
  if (s.indexOf('T') >= 0) return s.substring(0, 19);
  return s.substring(0, 19).replace(' ', 'T');
}

function rollbackAuditBurst_(atPrefix, apply) {
  atPrefix = String(atPrefix || '').trim();
  if (!atPrefix) return { error: 'at required (e.g. 2026-06-24T10:38:47)' };

  var rows = readAllAuditRows_();
  var burst = rows.filter(function (row) {
    return parseAuditTimestamp_(row[0]).indexOf(atPrefix) === 0;
  });
  if (!burst.length) return { error: 'No audit rows for ' + atPrefix };

  var current = loadState_() || { deals: [] };
  var dealMap = {};
  current.deals.forEach(function (d) {
    if (d && d.id) dealMap[d.id] = cloneDeal_(d);
  });

  var plan = [];
  var patches = 0;
  burst.forEach(function (row) {
    var dealId = String(row[2] || '');
    var label = String(row[6] || '');
    var oldVal = row[7];
    if (!dealId || !label || label === '—') return;
    if (!dealMap[dealId]) return;
    plan.push({ dealId: dealId, customer: dealMap[dealId].customer || '', label: label, value: oldVal });
    if (apply && applyAuditFieldToDeal_(dealMap[dealId], label, oldVal)) patches++;
  });

  if (!apply) {
    return { ok: true, applied: false, at: atPrefix, burstRows: burst.length, planCount: plan.length, plan: plan.slice(0, 50) };
  }

  PropertiesService.getScriptProperties().setProperty('MAINTENANCE_MODE', '1');
  var recovered = JSON.parse(JSON.stringify(current));
  recovered.deals = current.deals.map(function (d) {
    return dealMap[d.id] ? dealMap[d.id] : d;
  });
  var diffRows = diffPipeline_(current, recovered);
  appendAudit_('rollback-' + atPrefix, diffRows);
  var updatedAt = saveState_(recovered);
  invalidatePipelineCache_();
  return {
    ok: true,
    applied: true,
    at: atPrefix,
    burstRows: burst.length,
    patches: patches,
    auditRows: diffRows.length,
    updatedAt: updatedAt,
    maintenanceMode: true
  };
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
  getSnapshotDailySheet_();
  getSnapshotDealsSheet_();
  installSnapshotTrigger_();
  Logger.log('Листы _pipeline, _audit, _snapshots_* готовы. Триггер снапшота 23:59 МСК установлен. Развернуть → Веб-приложение.');
}

var SCORE_WEIGHTS_GAS_ = {
  loyalty: 0.10, commit: 0.10, budget: 0.18, fit: 0.18, timing: 0.14,
  competitive: 0.10, access: 0.08, technical: 0.06, commercial: 0.06
};

function calcDealScoreGas_(scores) {
  if (!scores) return 0;
  var sum = 0;
  var k;
  for (k in SCORE_WEIGHTS_GAS_) {
    if (SCORE_WEIGHTS_GAS_.hasOwnProperty(k)) sum += (scores[k] || 0) * SCORE_WEIGHTS_GAS_[k];
  }
  return Math.round((sum / 5) * 100);
}

function calcCategoryGas_(score) {
  if (score >= 80) return 'Горячая';
  if (score >= 60) return 'Тёплая';
  if (score >= 40) return 'Наблюдение';
  return 'Отказ';
}

function isWeightedDealGas_(score, category) {
  return category === 'Горячая' || category === 'Тёплая' || score >= 60;
}

function formatDateMsk_(date) {
  return Utilities.formatDate(date, 'Europe/Moscow', 'yyyy-MM-dd');
}

function getSnapshotDailySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SNAPSHOT_DAILY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SNAPSHOT_DAILY_SHEET);
    sh.hideSheet();
    sh.appendRow(['date', 'ts', 'dealCount', 'totalPipeline', 'weightedPipeline', 'hotCount', 'warmCount', 'avgScore']);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getSnapshotDealsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SNAPSHOT_DEALS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SNAPSHOT_DEALS_SHEET);
    sh.hideSheet();
    sh.appendRow(['date', 'ts', 'dealId', 'customer', 'owner', 'score', 'amount', 'category']);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function removeSnapshotForDate_(dateStr) {
  [getSnapshotDailySheet_(), getSnapshotDealsSheet_()].forEach(function (sh) {
    var last = sh.getLastRow();
    if (last < 2) return;
    var vals = sh.getRange(2, 1, last, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]) === dateStr) sh.deleteRow(i + 2);
    }
  });
}

function takeDailySnapshot_(source) {
  source = source || 'cron';
  var tz = 'Europe/Moscow';
  var today = formatDateMsk_(new Date());
  var ts = new Date().toISOString();
  var state = loadState_() || { deals: [] };
  var deals = state.deals || [];
  removeSnapshotForDate_(today);

  var totalPipeline = 0;
  var weightedPipeline = 0;
  var hotCount = 0;
  var warmCount = 0;
  var scoreSum = 0;
  var scoreN = 0;
  var dealRows = [];

  deals.forEach(function (d) {
    if (!d || !d.id) return;
    var score = calcDealScoreGas_(d.scores);
    var category = calcCategoryGas_(score);
    var amount = Number(d.amount) || 0;
    totalPipeline += amount;
    if (isWeightedDealGas_(score, category)) weightedPipeline += amount;
    if (category === 'Горячая') hotCount++;
    if (category === 'Тёплая') warmCount++;
    if (score > 0) { scoreSum += score; scoreN++; }
    dealRows.push([
      today, ts, String(d.id), String(d.customer || ''), String(d.owner || ''),
      score, amount, category
    ]);
  });

  var avgScore = scoreN ? Math.round(scoreSum / scoreN) : 0;
  getSnapshotDailySheet_().appendRow([
    today, ts, deals.length, totalPipeline, weightedPipeline, hotCount, warmCount, avgScore
  ]);
  if (dealRows.length) {
    getSnapshotDealsSheet_().getRange(
      getSnapshotDealsSheet_().getLastRow() + 1, 1, dealRows.length, 8
    ).setValues(dealRows);
  }
  return {
    ok: true,
    source: source,
    date: today,
    dealCount: deals.length,
    totalPipeline: totalPipeline,
    weightedPipeline: weightedPipeline,
    avgScore: avgScore
  };
}

function dailySnapshot_() {
  takeDailySnapshot_('cron');
}

function installSnapshotTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailySnapshot_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailySnapshot_')
    .timeBased()
    .atHour(23)
    .nearMinute(59)
    .everyDays(1)
    .inTimezone('Europe/Moscow')
    .create();
}

function readSnapshotDailySince_(fromDateStr) {
  var sh = getSnapshotDailySheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last, 8).getValues();
  return rows.filter(function (r) { return String(r[0]) >= fromDateStr; }).map(function (r) {
    return {
      date: String(r[0]),
      ts: String(r[1]),
      dealCount: +r[2] || 0,
      totalPipeline: +r[3] || 0,
      weightedPipeline: +r[4] || 0,
      hotCount: +r[5] || 0,
      warmCount: +r[6] || 0,
      avgScore: +r[7] || 0
    };
  });
}

function readDealSnapshotsForDate_(dateStr) {
  var sh = getSnapshotDealsSheet_();
  var last = sh.getLastRow();
  if (last < 2) return {};
  var rows = sh.getRange(2, 1, last, 8).getValues();
  var map = {};
  rows.forEach(function (r) {
    if (String(r[0]) !== dateStr) return;
    map[String(r[2])] = {
      dealId: String(r[2]),
      customer: String(r[3]),
      owner: String(r[4]),
      score: +r[5] || 0,
      amount: +r[6] || 0,
      category: String(r[7])
    };
  });
  return map;
}

function parseAuditScore_(raw) {
  try {
    var sc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return calcDealScoreGas_(sc);
  } catch (e) {
    return null;
  }
}

function parseAuditWhen_(when) {
  if (!when) return null;
  var d = new Date(when);
  return isNaN(d.getTime()) ? null : d;
}

function buildAuditScoreTimeline_() {
  var rows = readAllAuditRows_();
  var timeline = {};
  rows.forEach(function (row) {
    if (String(row[6]) !== 'Скоринг') return;
    var dealId = String(row[2] || '');
    if (!dealId) return;
    var when = parseAuditWhen_(row[0]);
    if (!when) return;
    var score = parseAuditScore_(row[8]);
    if (score == null) return;
    if (!timeline[dealId]) timeline[dealId] = [];
    timeline[dealId].push({ when: when, score: score, customer: String(row[3] || ''), owner: String(row[5] || '') });
  });
  Object.keys(timeline).forEach(function (id) {
    timeline[id].sort(function (a, b) { return a.when - b.when; });
  });
  return timeline;
}

function scoreAtOrBefore_(timeline, dealId, cutoff) {
  var entries = timeline[dealId];
  if (!entries || !entries.length) return null;
  var found = null;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].when <= cutoff) found = entries[i];
    else break;
  }
  return found;
}

function periodDays_(period) {
  if (period === 'month') return 30;
  if (period === 'quarter') return 90;
  return 7;
}

function getDynamics_(period) {
  var days = periodDays_(period);
  var now = new Date();
  var from = new Date(now.getTime() - days * 86400000);
  var fromStr = formatDateMsk_(from);
  var state = loadState_() || { deals: [] };
  var daily = readSnapshotDailySince_(fromStr);
  var baselineDate = daily.length ? daily[0].date : null;
  var baselineDeals = baselineDate ? readDealSnapshotsForDate_(baselineDate) : {};
  var auditTimeline = buildAuditScoreTimeline_();

  var deltas = [];
  (state.deals || []).forEach(function (d) {
    if (!d || !d.id) return;
    var curScore = calcDealScoreGas_(d.scores);
    var base = baselineDeals[d.id];
    var baseScore = base ? base.score : null;
    var meta = base || {};
    if (baseScore == null) {
      var auditBase = scoreAtOrBefore_(auditTimeline, d.id, from);
      if (auditBase) {
        baseScore = auditBase.score;
        meta.customer = auditBase.customer;
        meta.owner = auditBase.owner;
      }
    }
    if (baseScore == null) return;
    var delta = curScore - baseScore;
    if (delta === 0) return;
    deltas.push({
      dealId: d.id,
      customer: d.customer || meta.customer || '',
      owner: d.owner || meta.owner || '',
      was: baseScore,
      now: curScore,
      delta: delta,
      amount: Number(d.amount) || 0
    });
  });

  deltas.sort(function (a, b) { return b.delta - a.delta; });
  var gains = deltas.filter(function (d) { return d.delta > 0; }).slice(0, 10);
  var losses = deltas.filter(function (d) { return d.delta < 0; }).sort(function (a, b) { return a.delta - b.delta; }).slice(0, 10);

  var first = daily[0] || null;
  var last = daily.length ? daily[daily.length - 1] : null;
  var curTotals = { dealCount: 0, totalPipeline: 0, weightedPipeline: 0, avgScore: 0, hotCount: 0 };
  var scSum = 0;
  var scN = 0;
  (state.deals || []).forEach(function (d) {
    if (!d) return;
    curTotals.dealCount++;
    var amount = Number(d.amount) || 0;
    var score = calcDealScoreGas_(d.scores);
    var category = calcCategoryGas_(score);
    curTotals.totalPipeline += amount;
    if (isWeightedDealGas_(score, category)) curTotals.weightedPipeline += amount;
    if (category === 'Горячая') curTotals.hotCount++;
    if (score > 0) { scSum += score; scN++; }
  });
  curTotals.avgScore = scN ? Math.round(scSum / scN) : 0;

  var summary = {
    pipelineDelta: last ? curTotals.totalPipeline - last.totalPipeline : (first ? curTotals.totalPipeline - first.totalPipeline : 0),
    weightedDelta: last ? curTotals.weightedPipeline - last.weightedPipeline : (first ? curTotals.weightedPipeline - first.weightedPipeline : 0),
    avgScoreDelta: last ? curTotals.avgScore - last.avgScore : (first ? curTotals.avgScore - first.avgScore : 0),
    dealCountDelta: last ? curTotals.dealCount - last.dealCount : (first ? curTotals.dealCount - first.dealCount : 0),
    baselineDate: baselineDate,
    snapshotDays: daily.length
  };

  if (!daily.length) {
    daily.push({
      date: formatDateMsk_(now),
      dealCount: curTotals.dealCount,
      totalPipeline: curTotals.totalPipeline,
      weightedPipeline: curTotals.weightedPipeline,
      hotCount: curTotals.hotCount,
      warmCount: 0,
      avgScore: curTotals.avgScore,
      live: true
    });
  } else {
    daily.push({
      date: formatDateMsk_(now),
      dealCount: curTotals.dealCount,
      totalPipeline: curTotals.totalPipeline,
      weightedPipeline: curTotals.weightedPipeline,
      hotCount: curTotals.hotCount,
      warmCount: 0,
      avgScore: curTotals.avgScore,
      live: true
    });
  }

  return {
    ok: true,
    period: period,
    days: days,
    from: fromStr,
    pipelineTrend: daily,
    summary: summary,
    topGains: gains,
    topLosses: losses,
    hasSnapshots: readSnapshotDailySince_('2000-01-01').length > 0
  };
}
