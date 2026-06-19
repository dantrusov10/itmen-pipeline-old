/* Справочники, сегменты, легенды скоринга */
window.ITMEN_CONFIG = {
  scoreCriteria: [
    { key: "loyalty", name: "Лояльность клиента к нам", weight: 0.10, question: "Насколько клиент нам лоялен, доверяет нам и готов продвигать нас внутри?", manualOnly: true },
    { key: "commit", name: "Подтверждение коммита клиента", weight: 0.10, question: "Насколько клиент подтвердил намерение участвовать в закупке?" },
    { key: "budget", name: "Определённость бюджета", weight: 0.18, question: "Насколько понятен и подтверждён бюджет на проект?" },
    { key: "fit", name: "Соответствие проблеме", weight: 0.18, question: "Насколько ITMen закрывает заявленные боли и выбранные сегменты?" },
    { key: "timing", name: "Срочность сроков", weight: 0.14, question: "Когда клиент готов принять решение?" },
    { key: "competitive", name: "Конкурентная позиция", weight: 0.10, question: "Насколько мы конкурентны в этой сделке?" },
    { key: "access", name: "Доступ / влияние", weight: 0.08, question: "Есть ли доступ к ЛПР и понятна ли карта влияния?" },
    { key: "technical", name: "Техн. соответствие", weight: 0.06, question: "Насколько продукт закрывает % требований проекта и пилота?" },
    { key: "commercial", name: "Коммерч. готовность клиента", weight: 0.06, question: "Насколько клиент готов к закупке: процесс, сроки, участники?" },
  ],

  manualScoreKeys: ["loyalty"],

  scoreRubrics: {
    loyalty: {
      s5: "Есть чемпион, высокое доверие, активно продвигают нас внутри",
      s4: "Сильный контакт, позитивные отношения, готовы идти с нами",
      s3: "Нейтральные отношения, сравнивают на равных с конкурентами",
      s2: "Слабый контакт, мало доверия, нужен «прогрев»",
      s1: "Холодно / предпочитают других, нет адвоката",
      s0: "Нет контакта или негатив к нам",
    },
    commit: {
      s5: "Контракт / заказ подписан — обязательство зафиксировано",
      s4: "LOI или гарантийное письмо — формальное намерение",
      s3: "Протокол встречи с зафиксированными next steps",
      s2: "Email или устное подтверждение интереса",
      s1: "Слабые сигналы, без письменной фиксации",
      s0: "Нет подтверждения от клиента",
    },
    budget: {
      s5: "Бюджет подтверждён, сумма и срок известны",
      s4: "Бюджет в согласовании, сумма оценена",
      s3: "Согласование запланировано, порядок величины понятен",
      s2: "Бюджет предполагается, без дат",
      s1: "Бюджет под большим вопросом",
      s0: "Бюджета нет / неизвестно",
    },
    fit: {
      s5: "Все ключевые сегменты и боли — прямое попадание ITMen",
      s4: "Основные боли закрываем, мелкие пробелы",
      s3: "Закрываем часть сегментов, есть gaps",
      s2: "Косвенное соответствие, много доработок",
      s1: "Слабое соответствие",
      s0: "Не наш профиль / нет боли",
    },
    timing: {
      s5: "Решение в текущем квартале, есть триггер",
      s4: "Решение в ближайшие 2 квартала",
      s3: "Решение в следующем бюджетном цикле",
      s2: "Длинный цикл, слабый триггер",
      s1: "Сроки размыты",
      s0: "Нет сроков / на паузе",
    },
    competitive: {
      s5: "Мы предпочтительны / в шорт-листе №1",
      s4: "В шорт-листе, сильная дифференциация",
      s3: "Сравнивают нас с 2–3 вендорами на равных",
      s2: "Коммодити-сравнение, цена решает",
      s1: "Конкурент сильнее",
      s0: "Выбран другой вендор",
    },
    access: {
      s5: "Доступ к ЛПР и бюджетодержателю, карта влияния ясна",
      s4: "Есть выход на ЛПР через чемпиона",
      s3: "Работаем с уровнем ниже ЛПР",
      s2: "Карта влияния не ясна",
      s1: "Только формальные контакты",
      s0: "Нет доступа",
    },
    technical: {
      s5: "≥90% требований проекта и пилота закрыты",
      s4: "75–89% — небольшие доработки",
      s3: "60–74% — умеренный scope доработок",
      s2: "40–59% — существенный gap",
      s1: "20–39% — слабое соответствие",
      s0: "<20% — не проходим по требованиям",
    },
    commercial: {
      s5: "Клиент готов к контракту: закупка, сроки, участники согласованы",
      s4: "КП/условия в работе, процесс закупки понятен",
      s3: "Интерес есть, закупка не формализована",
      s2: "Ранний этап, нет процесса закупки",
      s1: "Нет намерения покупать в обозримом горизонте",
      s0: "Закупка заморожена / отказ",
    },
  },

  techSegments: [
    { id: "cmdb", label: "CMDB", className: "CMDB / Asset Data Hub Golden Record" },
    { id: "discovery", label: "Discovery / инвентаризация", className: "Discovery & Inventory (нормализация как подпоток данных)" },
    { id: "itsm", label: "ITSM", className: "ITSM" },
    { id: "service_desk", label: "Service Desk", className: "Service Desk" },
    { id: "itam", label: "ITAM", className: "ITAM" },
    { id: "sam", label: "SAM", className: "SAM" },
    { id: "monitoring", label: "Мониторинг", className: "Monitoring / Event" },
  ],

  projectTasks: [
    { id: "inventory_cmdb", label: "Инвентаризация / CMDB / golden record" },
    { id: "itsm_process", label: "ITSM-процессы (инциденты, изменения, SLA)" },
    { id: "service_desk", label: "Service Desk / L1–L2" },
    { id: "itam_lifecycle", label: "Жизненный цикл активов (ITAM)" },
    { id: "sam_compliance", label: "SAM / лицензии / compliance ПО" },
    { id: "monitoring", label: "Мониторинг / алертинг / observability" },
    { id: "integration", label: "Интegrация систем / API / ESB" },
    { id: "replace_legacy", label: "Замена legacy / миграция" },
    { id: "pilot_poc", label: "Пилот / POC" },
    { id: "reporting", label: "Отчётность / KPI / дашборды" },
    { id: "security", label: "ИБ / compliance / audit trail" },
    { id: "automation", label: "Автоматизация / оркестрация" },
  ],

  budgetPeriods: [
    "Q3 2026", "Q4 2026", "Q1 2027", "Q2 2027", "Q3 2027", "Q4 2027",
    "Не определён", "После 2027",
  ],

  budgetStatuses: [
    "Подтверждён", "В процессе согласования", "Планируется согласование", "Нет бюджета", "Неизвестно",
  ],

  competitorStatuses: [
    { id: "reviewed", label: "Уже смотрели" },
    { id: "evaluating", label: "Ещё смотрят" },
    { id: "planned", label: "Планируют смотреть" },
    { id: "rejected", label: "Отказались" },
    { id: "selected", label: "Выбрали (не мы)" },
  ],

  managerSheetMap: {
    "Мерлейн": "Аркадий Мерлейн",
    "Ахметшин": "Арслан Ахметшин",
    "Сироткин": "Александр Сироткин",
    "Кулагин": "Алексей Кулагин",
  },

  commitStatuses: [
    { id: "none", label: "Нет подтверждения", short: "Нет", desc: "Нет подтверждения от клиента" },
    { id: "verbal", label: "Устное согласие", short: "Устное", desc: "Устное подтверждение интереса" },
    { id: "email", label: "Email / переписка", short: "Email", desc: "Зафиксированная переписка" },
    { id: "protocol", label: "Протокол встречи", short: "Протокол", desc: "Протокол с next steps" },
    { id: "loi", label: "Письмо о намерениях (LOI)", short: "LOI", desc: "Letter of Intent" },
    { id: "guarantee", label: "Гарантийное письмо", short: "Гарантийное письмо", desc: "Гарантия участия в закупке" },
    { id: "contract", label: "Контракт / заказ", short: "Контракт", desc: "Подписан договор" },
  ],

  nextStepTypes: [
    { id: "intro", label: "Intro-call / назначить владельца" },
    { id: "discovery", label: "Discovery — потребность и ЛПР" },
    { id: "budget", label: "Уточнить бюджетный цикл" },
    { id: "competitors", label: "Информация о конкурентах" },
    { id: "demo", label: "Согласовать и провести демо" },
    { id: "pilot_prep", label: "Подготовить пилот" },
    { id: "pilot", label: "Провести пилот" },
    { id: "proposal", label: "Подготовить и отправить КП" },
    { id: "terms", label: "Согласовать условия / компред" },
    { id: "contract", label: "Согласовать договор" },
    { id: "pause", label: "Поставить на паузу" },
    { id: "other", label: "Другое" },
  ],

  riskTypes: [
    { id: "none", label: "Критических рисков нет" },
    { id: "no_budget", label: "Нет подтверждённого бюджета" },
    { id: "no_lpr", label: "Нет доступа к ЛПР" },
    { id: "competitor", label: "Сильный конкурент" },
    { id: "timing", label: "Сроки сдвигаются" },
    { id: "technical", label: "Технический gap" },
    { id: "complex", label: "Неясен контур проекта" },
    { id: "stale", label: "Долго нет активности" },
    { id: "other", label: "Другое" },
  ],

  fieldHints: {
    taskDue: "Срок ближайшей задачи (как в amoCRM).",
    budgetPeriod: "Когда ожидаем решение по бюджету.",
    expectedAmount: "Бюджет из выгрузки AmoCRM.",
    expectedBudget: "Оборот сделки из выгрузки AmoCRM.",
    productReqPct: "Оценка: какой % требований проекта закрывает наш продукт (0–100).",
    pilotReqPct: "Оценка: какой % требований пилота закрывает наш продукт (0–100).",
  },
};

function buildScoreScale(rubric) {
  if (!rubric) return {};
  if (rubric.s1 && rubric.s2) {
    return { 5: rubric.s5, 4: rubric.s4, 3: rubric.s3, 2: rubric.s2, 1: rubric.s1 };
  }
  const mid = (a, b) => (a && b) ? `${a} → ${b}` : (a || b || "—");
  return {
    5: rubric.s5 || "—", 4: mid(rubric.s5, rubric.s3),
    3: rubric.s3 || "—", 2: mid(rubric.s3, rubric.s1), 1: rubric.s1 || "—",
  };
}

function getScoringRubric(key) {
  return window.ITMEN_CONFIG?.scoreRubrics?.[key] || null;
}

function getMergedScoringItems(scoringSource) {
  const criteria = window.ITMEN_CONFIG?.scoreCriteria || [];
  const old = scoringSource || window.ITMEN_INITIAL?.scoring || [];
  const keyHints = {
    loyalty: "Лояльность", commit: "Коммит", budget: "Определённость", fit: "Соответствие",
    timing: "Срочность", competitive: "Конкурент", access: "Доступ",
    technical: "Техн", commercial: "Коммерч",
  };
  return criteria.map(c => {
    const prev = old.find(o => o.name === c.name || (keyHints[c.key] && o.name?.includes(keyHints[c.key]))) || {};
    const rub = getScoringRubric(c.key) || {};
    return {
      key: c.key,
      name: c.name,
      weight: c.weight,
      question: c.question,
      col: prev.col || "—",
      owner: prev.owner || "—",
      ...rub,
    };
  });
}

function syncScoringFromConfig(s) {
  if (!s) return s;
  s.scoring = getMergedScoringItems(s.scoring).map(({ key, ...rest }) => rest);
  return s;
}
