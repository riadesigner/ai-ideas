import assert from "node:assert/strict";
import test from "node:test";
import { parseModelContent, parseModelList, prepareDictation } from "./text.ts";

test("вырезает стоп только в конце фразы", () => {
  assert.equal(prepareDictation("хочу стол стоп"), "хочу стол");
  assert.equal(prepareDictation("  идея   стоп. "), "идея");
  assert.equal(prepareDictation("СТОП"), "");
  assert.equal(prepareDictation("не стоп а дальше"), "не стоп а дальше");
  assert.equal(prepareDictation("стопка книг"), "стопка книг");
  assert.equal(prepareDictation(""), "");
});

test("читает название и текст из ответа модели", () => {
  const parsed = parseModelContent('```json\n{"title":"Лампа","body":"Сделать лампу."}\n```');
  assert.equal(parsed.title, "Лампа");
  assert.equal(parsed.body, "Сделать лампу.");
});

test("достаёт JSON, если модель добавила фразу вокруг", () => {
  const parsed = parseModelContent('Готово: {"title":"Короткое","body":"Одна мысль."} конец');
  assert.equal(parsed.title, "Короткое");
  assert.equal(parsed.body, "Одна мысль.");
});

test("берёт не больше трёх разных моделей", () => {
  assert.deepEqual(parseModelList(" gpt-4o-mini, gpt-4o ,gpt-4o-mini, claude "), [
    "gpt-4o-mini",
    "gpt-4o",
    "claude",
  ]);
  assert.deepEqual(parseModelList("a,b,c,d"), ["a", "b", "c"]);
  assert.deepEqual(parseModelList("deepseek/deepseek-r1, anthropic/claude-haiku-5.5, qwen/qwen3.6-plus"), [
    "deepseek/deepseek-r1",
    "anthropic/claude-haiku-5.5",
    "qwen/qwen3.6-plus",
  ]);
  assert.deepEqual(parseModelList("  "), ["gpt-4o-mini"]);
});

test("отклоняет пустой ответ", () => {
  assert.throws(() => parseModelContent('{"title":"","body":"текст"}'), /не вернула идею/);
});
