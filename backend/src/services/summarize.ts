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

export type Summary = { model: string; title: string; body: string };

export async function summarizeAll(text: string): Promise<{ options: Summary[]; failed: string[] }> {
  if (!env.llmApiKey) {
    const error = new Error("На сервере не задан ключ модели.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }
  const models = env.llmModels;
  const settled = await Promise.allSettled(models.map((model) => summarizeOne(model, text)));
  const options: Summary[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      options.push(result.value);
      return;
    }
    failed.push(models[index]);
    console.error("summarize", models[index]);
  });
  if (!options.length) {
    const error = new Error("Модель не ответила.");
    (error as Error & { status?: number }).status = 502;
    throw error;
  }
  return { options, failed };
}

async function summarizeOne(model: string, text: string): Promise<Summary> {
  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: text },
    ],
  };
  let response = await postCompletion({ ...payload, response_format: { type: "json_object" } });
  if (response.status === 400) {
    response = await postCompletion(payload);
  }
  if (!response.ok) {
    throw new Error("Модель не ответила.");
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const summary = parseModelContent(content);
  return { model, ...summary };
}

function postCompletion(payload: unknown): Promise<Response> {
  return fetch(`${env.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  });
}
