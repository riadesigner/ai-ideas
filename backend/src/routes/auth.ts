import { Router } from "express";
import type { Response } from "express";
import { env, isLocalOrigin, isOwnerEmail } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { clearAuthCookie, readAuthCookie, setAuthCookie, signAccessToken, verifyAccessToken, cookieOptions } from "../services/jwt.js";
import {
  createOAuthState,
  exchangeMailruCode,
  fetchMailruEmail,
  mailruAuthorizeUrl,
  mailruConfigured,
} from "../services/mailru.js";
import type { AuthedRequest } from "../middleware/auth.js";

export const authRouter = Router();
const STATE_COOKIE = "oauth_state";

function go(res: Response, path: string) {
  res.redirect(303, `${env.appOrigin}${path}`);
}

async function upsertOwner(email: string) {
  const normalized = email.toLowerCase();
  return prisma.user.upsert({
    where: { email: normalized },
    update: {},
    create: { id: crypto.randomUUID(), email: normalized },
  });
}

authRouter.get("/me", async (req: AuthedRequest, res) => {
  const token = readAuthCookie(req.cookies);
  if (!token) {
    res.json({ user: null });
    return;
  }
  try {
    const payload = await verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !isOwnerEmail(user.email)) {
      res.json({ user: null });
      return;
    }
    res.json({ user: { email: user.email } });
  } catch {
    res.json({ user: null });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/dev-login", async (_req, res) => {
  if (!env.devAuthBypass || !isLocalOrigin(env.appOrigin)) {
    res.status(403).json({ error: "Локальный вход выключен." });
    return;
  }
  const email = env.ownerEmails[0];
  if (!email) {
    res.status(500).json({ error: "В OWNER_EMAILS нет адреса." });
    return;
  }
  const user = await upsertOwner(email);
  setAuthCookie(res, await signAccessToken(user.id));
  res.redirect(303, "/");
});

authRouter.get("/mailru", (_req, res) => {
  if (!mailruConfigured()) {
    res.status(501).json({ error: "Mail.ru OAuth не настроен." });
    return;
  }
  const state = createOAuthState();
  res.cookie(STATE_COOKIE, state, { ...cookieOptions(), maxAge: 10 * 60 * 1000 });
  res.redirect(mailruAuthorizeUrl(state));
});

authRouter.get("/mailru/callback", async (req: AuthedRequest, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const cookieState = typeof req.cookies?.[STATE_COOKIE] === "string" ? req.cookies[STATE_COOKIE] : "";
  res.clearCookie(STATE_COOKIE, { ...cookieOptions(), maxAge: 0 });
  if (!code || !state || state !== cookieState) {
    go(res, "/?error=oauth");
    return;
  }
  try {
    const accessToken = await exchangeMailruCode(code);
    const email = await fetchMailruEmail(accessToken);
    if (!isOwnerEmail(email)) {
      go(res, "/?error=forbidden");
      return;
    }
    const user = await upsertOwner(email);
    setAuthCookie(res, await signAccessToken(user.id));
    go(res, "/");
  } catch (error) {
    console.error("mailru callback");
    go(res, "/?error=oauth");
  }
});
