// tests/tooling/turnScheduleCallers.test.ts — one decision of when a seat acts, read only where a table keeps its clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const PRODUCTION = ["app", "components", "context", "lib", "server", "shared"];
const at = (...parts: string[]) => parts.join("/");
const MODULE = at("lib", "game", "turnSchedule.ts");
const SPEC = /(^|\/)game\/turnSchedule(\.ts)?$/;

const READERS: Record<string, string[]> = {
  turnSchedule: [at("context", "offlineDriver.ts"), at("server", "game", "gameTurn.ts")],
  TURN_POLICY: [at("components", "turnTimerUi.ts")],
  BOT_THINK_MS: [at("server", "game", "gameTimers.ts")],
};

const STATIC = /\b(import|export)\s+(type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function names(bindings: string): string[] {
  return bindings
    .slice(1, -1)
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith("type "))
    .map((b) => b.split(/\s+as\s+/)[0]);
}

/** Whether `text` reaches `name` at runtime: a named import or re-export, a namespace or star, or a dynamic import. */
function reaches(text: string, name: string): boolean {
  for (const [, , typeOnly, bindings, spec] of text.matchAll(STATIC)) {
    if (typeOnly || !SPEC.test(spec)) continue;
    if (bindings.startsWith("*") || names(bindings).includes(name)) return true;
  }
  return [...text.matchAll(DYNAMIC)].some(([, spec]) => SPEC.test(spec));
}

const readersOf = (name: string, sources: [string, string][]) =>
  sources.filter(([file, text]) => file !== MODULE && reaches(text, name)).map(([file]) => file).sort();

test("each turnSchedule export is read only where a table resolves it to its own clock", () => {
  const sources = sourcesUnder(root, PRODUCTION);
  assert.ok(sources.length > 200, `scanned only ${sources.length} production files`);
  for (const [name, readers] of Object.entries(READERS)) assert.deepEqual(readersOf(name, sources), readers, name);
});

test("probe: a planted reader is found by every route in, and a type-only import is not", () => {
  const planted: [string, string][] = [
    [at("components", "a.tsx"), 'import { BOT_THINK_MS, turnSchedule } from "@/lib/game/turnSchedule";'],
    [at("server", "b.ts"), 'import * as schedule from "../lib/game/turnSchedule.ts";'],
    [at("lib", "c.ts"), 'import { turnSchedule as when, type Gate } from "./game/turnSchedule.ts";'],
    [at("lib", "d.ts"), 'import type { Gate, TURN_POLICY } from "../game/turnSchedule.ts";'],
    [at("lib", "e.ts"), 'export { TURN_POLICY } from "./game/turnSchedule.ts";'],
    [at("lib", "f.ts"), 'export * from "./game/turnSchedule.ts";'],
    [at("app", "g.tsx"), 'const later = () => import("@/lib/game/turnSchedule");'],
    [at("lib", "h.ts"), 'import { type TURN_POLICY } from "./game/turnSchedule.ts";'],
  ];
  assert.deepEqual(readersOf("turnSchedule", planted), [at("app", "g.tsx"), at("components", "a.tsx"), at("lib", "c.ts"), at("lib", "f.ts"), at("server", "b.ts")]);
  assert.deepEqual(readersOf("TURN_POLICY", planted), [at("app", "g.tsx"), at("lib", "e.ts"), at("lib", "f.ts"), at("server", "b.ts")]);
  assert.deepEqual(readersOf("BOT_THINK_MS", planted), [at("app", "g.tsx"), at("components", "a.tsx"), at("lib", "f.ts"), at("server", "b.ts")]);
});
