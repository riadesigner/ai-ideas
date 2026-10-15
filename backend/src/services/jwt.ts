import { SignJWT, jwtVerify } from "jose";
import type { Response } from "express";
import { env, useSecureCookies } from "../lib/env.js";

const cookieName = "access_token";

function secretKey(): Uint8Array {
  if (!env.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(env.jwtSecret);
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, secretKey());
  const userId = typeof payload.userId === "string" ? payload.userId : payload.sub;
  if (!userId) {
    throw new Error("Invalid token payload");
  }
  return { userId };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: useSecureCookies(),
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(cookieName, token, cookieOptions());
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(cookieName, { ...cookieOptions(), maxAge: 0 });
}

export function readAuthCookie(cookies: Record<string, unknown> | undefined): string {
  const value = cookies?.[cookieName];
  return typeof value === "string" ? value : "";
}
