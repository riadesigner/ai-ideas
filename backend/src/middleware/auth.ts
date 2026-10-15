import type { NextFunction, Request, Response } from "express";
import { isOwnerEmail } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { readAuthCookie, verifyAccessToken } from "../services/jwt.js";

export type AuthUser = {
  id: string;
  email: string;
};

export type AuthedRequest = Request & {
  authUser?: AuthUser;
  cookies?: Record<string, string>;
};

export async function requireOwner(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readAuthCookie(req.cookies);
  if (!token) {
    res.status(401).json({ error: "Нужно войти." });
    return;
  }
  try {
    const payload = await verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !isOwnerEmail(user.email)) {
      res.status(403).json({ error: "Этот ящик не открывает диктовку." });
      return;
    }
    req.authUser = { id: user.id, email: user.email };
    next();
  } catch {
    res.status(401).json({ error: "Нужно войти." });
  }
}
