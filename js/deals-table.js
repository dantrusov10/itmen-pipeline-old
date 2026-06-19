/* Таблица сделок — компактный вид, сортировка + общий поиск */
const DEALS_TABLE_COLS = [
  {
    key: "customer",
    label: "Клиент / стадия",
    get: d => `${d.customer} ${d.stage}`,
    render(d) {
      return `<td class="col-customer">
        <strong>${escapeHtml(d.customer)}</strong>
        <div class="cell-sub">${escapeHtml(d.stage)}</div>
      </td>`;
    },
  },
  {
    key: "owner",
    label: "Владелец",
    get: d => d.owner,
    render(d) {
      return `<td>${escapeHtml(d.owner)}</td>`;
    },
  },
  {
    key: "amount",
    label: "Ожид. сумма",
    num: true,
    get: d => d.amount,
    render(d) {
      return `<td class="num col-amount">
        ${formatMoney(d.amount)}
        <div class="cell-sub">${formatMoney(d.weighted)} взв.</div>
      </td>`;
    },
  },
  {
    key: "score",
    label: "Балл",
    num: true,
    get: d => d.score,
    render(d) {
      return `<td class="num">${d.score ?? "—"}</td>`;
    },
  },
  {
    key: "category",
    label: "Категория",
    get: d => d.category,
    render(d) {
      return `<td>${categoryBadge(d.category)}</td>`;
    },
  },
  {
    key: "taskDue",
    label: "Задача до",
    get: d => d.taskDue,
    render(d) {
      const days = d.daysTo != null
        ? `<span class="cell-days ${d.daysTo < 0 ? "overdue" : ""}">${d.daysTo} дн.</span>`
        : "";
      return `<td class="col-date">${escapeHtml(d.taskDue || "—")}${days ? `<br>${days}` : ""}</td>`;
    },
  },
  {
    key: "risk",
    label: "Риск",
    get: d => d.riskFlag || d.quality,
    render(d) {
      if (d.riskFlag) {
        return `<td><span class="badge badge-danger badge-compact" title="${escapeHtml(d.riskFlag)}">${escapeHtml(d.riskFlag.length > 18 ? d.riskFlag.slice(0, 16) + "…" : d.riskFlag)}</span></td>`;
      }
      if (d.quality === "Неполный") {
        return `<td><span class="badge badge-warn badge-compact">Неполный</span></td>`;
      }
      return `<td class="muted">—</td>`;
    },
  },
];

let dealsTableSort = { key: "amount", dir: "desc" };
let dealsTableSearch = "";
let dealsTableBound = false;

function dealCellText(col, d) {
  const v = col.get(d);
  if (v == null || v === "") return "";
  return String(v);
}

function applyDealsTableFilters(deals) {
  const cat = document.getElementById("deal-filter")?.value;
  const q = document.getElementById("deal-quality-filter")?.value;
  let rows = deals;
  if (cat) rows = rows.filter(d => d.category === cat);
  if (q === "incomplete") rows = rows.filter(d => d.quality === "Неполный");
  if (q === "risk") rows = rows.filter(d => d.riskFlag);

  const search = (dealsTableSearch || "").trim().toLowerCase();
  if (search) {
    rows = rows.filter(d =>
      DEALS_TABLE_COLS.some(col => dealCellText(col, d).toLowerCase().includes(search))
    );
  }
  return rows;
}

function sortDealsTableRows(deals) {
  const col = DEALS_TABLE_COLS.find(c => c.key === dealsTableSort.key) || DEALS_TABLE_COLS[2];
  const dir = dealsTableSort.dir === "asc" ? 1 : -1;
  return [...deals].sort((a, b) => {
    const av = col.get(a);
    const bv = col.get(b);
    if (col.num) {
      const an = av == null || av === "" ? -Infinity : +av;
      const bn = bv == null || bv === "" ? -Infinity : +bv;
      return (an - bn) * dir;
    }
    return dealCellText(col, a).toLowerCase().localeCompare(dealCellText(col, b).toLowerCase(), "ru") * dir;
  });
}

function renderDealsTableRow(d) {
  const realIdx = state.deals.findIndex(x => x.id === d.id);
  const cls = d.quality === "Неполный" ? "row-incomplete" : d.riskFlag ? "row-risk" : "";
  return `<tr class="${cls}" data-id="${escapeHtml(d.id)}">
    ${DEALS_TABLE_COLS.map(c => c.render(d)).join("")}
    <td class="actions">
      <button class="btn btn-sm" onclick="openDealModal(${realIdx})" title="Редактировать">✏️</button>
      <button class="btn btn-sm btn-danger" onclick="deleteDeal(${realIdx})" title="Удалить">🗑</button>
    </td>
  </tr>`;
}

function updateDealsTableBody(deals) {
  const tbody = document.getElementById("deals-tbody");
  const meta = document.getElementById("deals-table-meta");
  if (!tbody) return;
  const filtered = sortDealsTableRows(applyDealsTableFilters(deals));
  tbody.innerHTML = filtered.map(renderDealsTableRow).join("");
  if (meta) meta.textContent = `Показано ${filtered.length} из ${deals.length}`;
}

function bindDealsTableEvents() {
  if (dealsTableBound) return;
  dealsTableBound = true;
  document.getElementById("page-deals")?.addEventListener("click", e => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    if (dealsTableSort.key === key) {
      dealsTableSort.dir = dealsTableSort.dir === "asc" ? "desc" : "asc";
    } else {
      dealsTableSort = { key, dir: key === "amount" || key === "score" ? "desc" : "asc" };
    }
    document.querySelectorAll("#deals-table th[data-sort]").forEach(el => {
      el.classList.toggle("sorted-asc", el.dataset.sort === dealsTableSort.key && dealsTableSort.dir === "asc");
      el.classList.toggle("sorted-desc", el.dataset.sort === dealsTableSort.key && dealsTableSort.dir === "desc");
    });
    updateDealsTableBody(getMetrics().deals);
  });
  document.getElementById("page-deals")?.addEventListener("input", e => {
    if (e.target.id === "deals-global-search") {
      dealsTableSearch = e.target.value;
      updateDealsTableBody(getMetrics().deals);
    }
  });
  document.getElementById("page-deals")?.addEventListener("change", e => {
    if (e.target.id === "deal-filter" || e.target.id === "deal-quality-filter") {
      updateDealsTableBody(getMetrics().deals);
    }
  });
}

function renderDealsTable(deals) {
  const el = document.getElementById("page-deals");
  if (!el) return;
  dealsTableBound = false;
  const sortMark = key => {
    if (dealsTableSort.key !== key) return "";
    return dealsTableSort.dir === "asc" ? " ▲" : " ▼";
  };
  el.innerHTML = `
    <div class="deals-toolbar">
      <button class="btn btn-primary" onclick="openDealModal()">+ Добавить</button>
      <label class="btn" style="cursor:pointer">⬆️ Excel<input type="file" id="btn-import-excel" accept=".xlsx,.xls" hidden></label>
      <input type="search" id="deals-global-search" class="deals-global-search" placeholder="Поиск по клиенту, владельцу, стадии…" value="${escapeHtml(dealsTableSearch)}">
      <select id="deal-filter" class="btn" style="width:auto">
        <option value="">Все категории</option>
        <option value="Горячая">Горячая</option>
        <option value="Тёплая">Тёплая</option>
        <option value="Наблюдение">Наблюдение</option>
      </select>
      <select id="deal-quality-filter" class="btn" style="width:auto">
        <option value="">Все</option>
        <option value="incomplete">Неполные</option>
        <option value="risk">С риском</option>
      </select>
      <span class="deals-table-meta" id="deals-table-meta"></span>
    </div>
    <div class="deals-table-shell">
      <table class="deals-table deals-table-compact" id="deals-table">
        <thead>
          <tr>${DEALS_TABLE_COLS.map(c =>
            `<th data-sort="${c.key}" class="sortable">${escapeHtml(c.label)}${sortMark(c.key)}</th>`
          ).join("")}<th class="col-actions"></th></tr>
        </thead>
        <tbody id="deals-tbody"></tbody>
      </table>
    </div>`;

  document.getElementById("btn-import-excel")?.addEventListener("change", e => {
    const f = e.target.files[0];
    if (f) importExcelFile(f);
    e.target.value = "";
  });

  bindDealsTableEvents();
  updateDealsTableBody(deals);
}
