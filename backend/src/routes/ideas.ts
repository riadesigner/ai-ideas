import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { prepareDictation } from "../lib/text.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireOwner } from "../middleware/auth.js";
import { knownModels, summarizeModel } from "../services/summarize.js";

function cleanField(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max);
}

export const ideasRouter = Router();

ideasRouter.use(requireOwner);

ideasRouter.get("/models", (_req, res) => {
  res.json({ models: knownModels() });
});

ideasRouter.post("/options", async (req: AuthedRequest, res) => {
  const text = prepareDictation(req.body && req.body.text);
  const model = cleanField(req.body && req.body.model, 120);
  if (!text) {
    res.status(400).json({ error: "Нет текста для идеи." });
    return;
  }
  if (text.length > 20000) {
    res.status(400).json({ error: "Текст слишком длинный." });
    return;
  }
  if (!model || !knownModels().includes(model)) {
    res.status(400).json({ error: "Такой модели нет в настройках." });
    return;
  }
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });
  try {
    const result = await summarizeModel(model, text, controller.signal);
    if (res.writableEnded || controller.signal.aborted) {
      return;
    }
    res.json(result);
  } catch (error) {
    if (res.writableEnded || controller.signal.aborted) {
      return;
    }
    const named = error as { status?: number; seconds?: number };
    const status = named.status === 503 ? 503 : 502;
    res.status(status).json({
      error: "Эта модель не ответила.",
      model,
      seconds: named.seconds,
    });
  }
});

ideasRouter.post("/", async (req: AuthedRequest, res) => {
  const userId = req.authUser!.id;
  const text = prepareDictation(req.body && req.body.text);
  const title = cleanField(req.body && req.body.title, 80);
  const body = cleanField(req.body && req.body.body, 20000);
  const model = cleanField(req.body && req.body.model, 120);
  if (!text) {
    res.status(400).json({ error: "Нет текста для идеи." });
    return;
  }
  if (text.length > 20000) {
    res.status(400).json({ error: "Текст слишком длинный." });
    return;
  }
  if (!title || !body) {
    res.status(400).json({ error: "Сначала выберите один из вариантов." });
    return;
  }
  try {
    const idea = await prisma.$transaction(async (tx) => {
      const min = await tx.idea.aggregate({
        where: { userId },
        _min: { sortOrder: true },
      });
      const sortOrder = (min._min.sortOrder ?? 0) - 1;
      return tx.idea.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          title,
          body,
          sourceText: text,
          model,
          sortOrder,
        },
      });
    });
    res.status(201).json(idea);
  } catch {
    console.error("save idea");
    res.status(500).json({ error: "Идея собрана, но не записалась. Попробуйте ещё раз." });
  }
});

ideasRouter.get("/", async (req: AuthedRequest, res) => {
  const ideas = await prisma.idea.findMany({
    where: { userId: req.authUser!.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  res.json({ ideas });
});

ideasRouter.put("/order", async (req: AuthedRequest, res) => {
  const userId = req.authUser!.id;
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== "string")) {
    res.status(400).json({ error: "Нужен список id." });
    return;
  }
  const existing = await prisma.idea.findMany({
    where: { userId },
    select: { id: true },
  });
  const known = new Set(existing.map((idea) => idea.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id: string) => !known.has(id))) {
    res.status(400).json({ error: "Список идей не совпал с базой. Обновите страницу." });
    return;
  }
  const ideas = await prisma.$transaction(async (tx) => {
    for (let index = 0; index < ids.length; index += 1) {
      await tx.idea.update({ where: { id: ids[index] }, data: { sortOrder: index } });
    }
    return tx.idea.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  });
  res.json({ ideas });
});

ideasRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const idea = await prisma.idea.findFirst({
    where: { id: req.params.id, userId: req.authUser!.id },
  });
  if (!idea) {
    res.status(404).json({ error: "Такой идеи уже нет." });
    return;
  }
  await prisma.idea.delete({ where: { id: idea.id } });
  res.json({ ok: true });
});
