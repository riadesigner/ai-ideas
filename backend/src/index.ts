import cookieParser from "cookie-parser";
import express from "express";
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { ideasRouter } from "./routes/ideas.js";

if (env.nodeEnv === "production" && !env.jwtSecret) {
  throw new Error("Missing env JWT_SECRET");
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/ideas", ideasRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Нет такого запроса." });
});

app.use((error: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error && error.type === "entity.parse.failed") {
    res.status(400).json({ error: "Непонятный запрос." });
    return;
  }
  console.error("request");
  res.status(500).json({ error: "Ошибка сервера." });
});

const server = app.listen(env.port, "0.0.0.0", () => {
  console.log(`api ${env.port}`);
  console.log(`models ${env.llmModels.join(", ")}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
