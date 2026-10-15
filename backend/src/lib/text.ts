const STOP_TAIL = /(?:^|\s+)стоп[.!?…]*$/iu;

export function prepareDictation(input: unknown): string {
  return String(input || "").trim().replace(STOP_TAIL, "").trim();
}

export function parseModelContent(content: unknown): { title: string; body: string } {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Пустой ответ модели");
  }
  let raw = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: { title?: unknown; body?: unknown };
  try {
    data = JSON.parse(raw) as { title?: unknown; body?: unknown };
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("Модель не вернула идею");
    }
    data = JSON.parse(raw.slice(start, end + 1)) as { title?: unknown; body?: unknown };
  }
  const title = String(data.title || "").replace(/\s+/g, " ").trim();
  const body = String(data.body || "").trim();
  if (!title || !body) {
    throw new Error("Модель не вернула идею");
  }
  return { title: title.slice(0, 80), body };
}
