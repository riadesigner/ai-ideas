import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { prepareDictation } from "../lib/text.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireOwner } from "../middleware/auth.js";
import { summarize } from "../services/summarize.js";

export const ideasRouter = Router();

ideasRouter.use(requireOwner);

ideasRouter.post("/", async (req: AuthedRequest, res) => {
  const userId = req.authUser!.id;
  const text = prepareDictation(req.body && req.body.text);
  if (!text) {
    res.status(400).json({ error: "Нет текста для идеи." });
    return;
  }
  if (text.length > 20000) {
    res.status(400).json({ error: "Текст слишком длинный." });
    return;
  }
  let summary: { title: string; body: string };
  try {
    summary = await summarize(text);
  } catch (error) {
    const status = (error as { status?: number }).status === 503 ? 503 : 502;
    console.error("summarize", status);
    res.status(status).json({
      error: "Не получилось собрать идею. Текст не сохранён, попробуйте ещё раз.",
    });
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
          title: summary.title,
          body: summary.body,
          sourceText: text,
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
