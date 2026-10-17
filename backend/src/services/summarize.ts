import { env } from "../lib/env.js";
import { parseModelContent } from "../lib/text.js";

const SYSTEM = [
  "Ты редактор устной заметки на русском языке.",
  "На входе сырой текст диктовки: часто без знаков препинания, с повторами, оговорками и обрывками фраз.",
  "Собери одну законченную идею.",
  "Убери повторы и слова-паразиты. Выстрой мысли в понятном порядке. Можно перефразировать, чтобы фраза стала цельной.",
  "Не добавляй фактов, примеров и выводов, которых человек не говорил.",
  "Если в тексте несколько разных тем, оставь их в одной записи и раздели абзацами в том порядке, в каком они сказаны.",
  "Название — короткая суть, без кавычек и без точки в конце, не длиннее 80 символов.",
  'Ответ — только JSON: {"title":"...","body":"..."}.',
].join("\n");

export type Summary = { model: string; title: string; body: string; seconds: number };

const MODEL_TIMEOUT_MS = 150_000;

export function knownModels(): string[] {
  return env.llmModels;
}

export async function summarizeModel(model: string, text: string, signal?: AbortSignal): Promise<Summary> {
  if (!env.llmApiKey) {
    const error = new Error("На сервере не задан ключ модели.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }
  const started = Date.now();
  try {
    const summary = await summarizeOne(model, text, signal);
    return { ...summary, seconds: secondsSince(started) };
  } catch (error) {
    const named = error as Error & { status?: number; seconds?: number };
    named.seconds = secondsSince(started);
    if (named.name !== "AbortError") {
      console.error("summarize", model, named.name || "error");
    }
    throw named;
  }
}

function secondsSince(started: number): number {
  return Math.max(1, Math.round((Date.now() - started) / 1000));
}

async function summarizeOne(model: string, text: string, signal?: AbortSignal): Promise<Omit<Summary, "seconds">> {
  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: text },
    ],
  };
  let response = await postCompletion({ ...payload, response_format: { type: "json_object" } }, signal);
  if (response.status === 400) {
    response = await postCompletion(payload, signal);
  }
  if (!response.ok) {
    throw new Error("Модель не ответила.");
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = stripThink(data.choices?.[0]?.message?.content ?? "");
  const summary = parseModelContent(content);
  return { model, ...summary };
}

function stripThink(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function postCompletion(payload: unknown, parent?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
  return fetch(`${env.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
}
