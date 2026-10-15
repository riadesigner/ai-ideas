import { randomBytes } from "node:crypto";
import { env } from "../lib/env.js";

const AUTHORIZE = "https://oauth.mail.ru/login";
const TOKEN = "https://oauth.mail.ru/token";
const USERINFO = "https://oauth.mail.ru/userinfo";

export function createOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function mailruConfigured(): boolean {
  return Boolean(env.mailruClientId && env.mailruClientSecret && env.mailruRedirectUri);
}

export function mailruAuthorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", env.mailruClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.mailruRedirectUri);
  url.searchParams.set("scope", "userinfo");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeMailruCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.mailruClientId,
    client_secret: env.mailruClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.mailruRedirectUri,
  });
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await response.json()) as { access_token?: string };
  if (!response.ok || !data.access_token) {
    throw new Error("Mail.ru token error");
  }
  return data.access_token;
}

export async function fetchMailruEmail(accessToken: string): Promise<string> {
  const url = new URL(USERINFO);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  const data = (await response.json()) as { email?: string };
  if (!response.ok || !data.email) {
    throw new Error("Mail.ru userinfo error");
  }
  return data.email.toLowerCase();
}
