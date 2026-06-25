"use strict";

const express = require("express");
const { mergePipelineStates } = require("./merge");
const { loadPipelineState, savePipelineState, saveSingleDeal, deleteDealByDealId } = require("./mapper");
const { writeDealAudit } = require("./audit");
const { ensureAuth, listAll } = require("./pb-client");
const {
  loginUser,
  requireAuth,
  requireAdmin,
  canEditDeal,
  canDeleteDeal,
} = require("./auth");

const { getDynamics } = require("./dynamics");
const { takeDailySnapshot } = require("./snapshot");

const app = express();
const PORT = Number(process.env.API_PORT || 3010);

app.use(express.json({ limit: "50mb" }));

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - t0;
    const user = req.user?.email || "-";
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${ms}ms user=${user}`);
  });
  next();
});

app.get("/api/health", async (_req, res) => {
  try {
    await ensureAuth();
    res.json({
      ok: true,
      service: "itmen-pipeline-api",
      pocketbase: process.env.PB_URL || "http://127.0.0.1:8095",
      ts: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Укажите email и пароль" });
    }
    const session = await loginUser(email, password);
    res.json({ ok: true, ...session });
  } catch (e) {
    res.status(401).json({ error: "Неверный email или пароль" });
  }
});

app.get("/api/auth/me", requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/pipeline", requireAuth(), async (req, res) => {
  try {
    const lite = req.query.lite === "1" || req.query.lite === "true";
    const state = await loadPipelineState({ lite });
    if (!state) return res.status(404).json({ error: "Пайплайн не найден" });
    res.json({ state });
  } catch (e) {
    console.error("GET /api/pipeline", e);
    res.status(500).json({ error: e.message || "Ошибка загрузки" });
  }
});

app.get("/api/pipeline/deals/:dealId", requireAuth(), async (req, res) => {
  try {
    const deal = await loadPipelineState({ dealId: req.params.dealId });
    if (!deal) return res.status(404).json({ error: "Сделка не найдена" });
    res.json({ deal, canEdit: canEditDeal(req.user, deal) });
  } catch (e) {
    console.error("GET deal", e);
    res.status(500).json({ error: e.message || "Ошибка загрузки сделки" });
  }
});

app.patch("/api/deals/:dealId", requireAuth(), async (req, res) => {
  try {
    const deal = req.body?.deal;
    if (!deal || deal.id !== req.params.dealId) {
      return res.status(400).json({ error: "Некорректное тело: ожидается deal с совпадающим id" });
    }

    const existing = await loadPipelineState({ dealId: deal.id });
    const isNew = !existing;

    if (!isNew && !canEditDeal(req.user, existing)) {
      return res.status(403).json({ error: "Можно редактировать только свои сделки" });
    }
    if (isNew && req.user.role !== "admin") {
      deal.owner = req.user.managerName;
    }
    if (req.user.role !== "admin" && deal.owner !== req.user.managerName) {
      return res.status(403).json({ error: "Нельзя сохранить сделку с другим владельцем" });
    }

    const savedBy = req.user.displayName || req.user.email;
    const { saved, oldDeal } = await saveSingleDeal(deal, { savedBy, isNew });
    const auditRows = await writeDealAudit({
      savedBy,
      oldDeal: oldDeal || existing,
      newDeal: saved,
      isNew,
    });

    res.json({
      ok: true,
      deal: saved,
      auditRows,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("PATCH /api/deals", e);
    res.status(500).json({ error: e.message || "Ошибка сохранения сделки" });
  }
});

app.delete("/api/deals/:dealId", requireAuth(), async (req, res) => {
  try {
    const deal = await loadPipelineState({ dealId: req.params.dealId });
    if (!deal) return res.status(404).json({ error: "Сделка не найдена" });
    if (!canDeleteDeal(req.user, deal)) {
      return res.status(403).json({ error: "Можно удалять только свои сделки" });
    }
    await deleteDealByDealId(req.params.dealId);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/deals", e);
    res.status(500).json({ error: e.message || "Ошибка удаления" });
  }
});

app.put("/api/pipeline", requireAuth(), requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const clientState = body.state;
    if (!clientState || !Array.isArray(clientState.deals)) {
      return res.status(400).json({ error: "Некорректное тело запроса" });
    }

    const editedDealIds = body.editedDealIds || [];
    const deletedDealIds = body.deletedDealIds || [];
    const forceFull = Boolean(body.forceFull);
    const baseDataEpoch = body.baseDataEpoch ?? clientState._dataEpoch ?? null;

    const serverState = await loadPipelineState({ lite: false });
    const serverCount = (serverState?.deals || []).length;
    const clientCount = clientState.deals.length;
    const serverEpoch = serverState?._dataEpoch || 1;

    if (forceFull) {
      if (serverCount >= 10 && clientCount < Math.max(5, Math.floor(serverCount * 0.5))) {
        return res.status(409).json({
          error: `Отклонено: в сохранении слишком мало сделок (${clientCount} из ${serverCount} на сервере). `
            + "Загрузите актуальные данные с сервера.",
        });
      }
      if (baseDataEpoch != null && serverEpoch > baseDataEpoch) {
        return res.status(409).json({
          error: `Данные на сервере новее (epoch ${serverEpoch} > ${baseDataEpoch}). Загрузите с сервера.`,
        });
      }
    }

    let mergedState;
    let conflicts = [];
    let keptServer = 0;
    let tookClient = 0;

    if (forceFull) {
      mergedState = clientState;
    } else {
      const mergeResult = mergePipelineStates(
        serverState,
        clientState,
        editedDealIds,
        deletedDealIds,
      );
      mergedState = mergeResult.state;
      conflicts = mergeResult.conflicts;
      keptServer = mergeResult.keptServer;
      tookClient = mergeResult.tookClient;
    }

    mergedState._savedBy = req.user.displayName || req.user.email;
    const savedState = await savePipelineState(mergedState, { deletedDealIds });

    res.json({
      ok: true,
      updatedAt: savedState._savedAt,
      dataEpoch: savedState._dataEpoch,
      auditRows: editedDealIds.length + deletedDealIds.length,
      state: savedState,
      conflicts,
      mergeKeptServer: keptServer,
      mergeTookClient: tookClient,
    });
  } catch (e) {
    console.error("PUT /api/pipeline", e);
    res.status(500).json({ error: e.message || "Ошибка сохранения" });
  }
});

app.get("/api/managers", requireAuth(), async (_req, res) => {
  try {
    const rows = await listAll("managers", { sort: "name" });
    res.json(rows.map(m => ({
      id: m.manager_id,
      name: m.name,
      sheet: m.sheet,
    })));
  } catch (e) {
    console.error("GET /api/managers", e);
    res.status(500).json({ error: e.message || "Ошибка загрузки менеджеров" });
  }
});

app.get("/api/dynamics", requireAuth(), async (req, res) => {
  try {
    const period = String(req.query.period || "week");
    const data = await getDynamics(period);
    res.json(data);
  } catch (e) {
    console.error("GET /api/dynamics", e);
    res.status(500).json({ error: e.message || "Ошибка динамики" });
  }
});

app.post("/api/admin/snapshot", requireAuth(), requireAdmin, async (_req, res) => {
  try {
    const result = await takeDailySnapshot("manual");
    res.json(result);
  } catch (e) {
    console.error("POST /api/admin/snapshot", e);
    res.status(500).json({ error: e.message || "Ошибка снапшота" });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`ITMen Pipeline API → http://127.0.0.1:${PORT}`);
});
