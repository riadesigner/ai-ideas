import { parseModelList } from "./text.js";

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

function originHost(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  appOrigin: (process.env.APP_ORIGIN ?? "http://localhost:8095").replace(/\/$/, ""),
  jwtSecret:
    process.env.JWT_SECRET?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "dev-only-change-me"),
  ownerEmails: (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  devAuthBypass: bool("DEV_AUTH_BYPASS", false),
  mailruClientId: process.env.MAILRU_CLIENT_ID?.trim() ?? "",
  mailruClientSecret: process.env.MAILRU_CLIENT_SECRET?.trim() ?? "",
  mailruRedirectUri: process.env.MAILRU_REDIRECT_URI?.trim() ?? "",
  llmBaseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
  llmApiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
  llmModels: parseModelList(process.env.LLM_MODELS, process.env.OPENAI_MODEL),
};

export function isLocalOrigin(origin: string): boolean {
  const host = originHost(origin);
  return host === "localhost" || host === "127.0.0.1";
}

export function isOwnerEmail(email: string): boolean {
  return env.ownerEmails.includes(email.toLowerCase());
}

export function useSecureCookies(): boolean {
  return env.appOrigin.startsWith("https://");
}
