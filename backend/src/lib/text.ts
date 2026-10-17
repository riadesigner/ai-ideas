const STOP_TAIL = /(?:^|\s+)стоп[.!?…]*$/iu;

function splitModels(raw: string | undefined): string[] {
  const unique: string[] = [];
  for (const name of String(raw || "").split(",")) {
    const trimmed = name.trim();
    if (!trimmed || unique.includes(trimmed)) {
      continue;
    }
    unique.push(trimmed);
    if (unique.length === 3) {
      break;
    }
  }
  return unique;
}

export function parseModelList(raw: string | undefined): string[] {
  const listed = splitModels(raw);
  return listed.length ? listed : ["gpt-4o-mini"];
}

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
