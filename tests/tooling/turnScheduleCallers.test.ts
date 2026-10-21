// tests/tooling/turnScheduleCallers.test.ts — one decision of when a seat acts, read by the two tables that keep a clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const PRODUCTION = ["app", "components", "context", "lib", "server", "shared"];
const MODULE = ["lib", "game", "turnSchedule.ts"].join("/");

const IMPORT = /import\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

function importers(sources: [string, string][]): string[] {
  return sources
    .filter(([file, text]) =>
      file !== MODULE &&
      [...text.matchAll(IMPORT)].some(([, typeOnly, bindings, spec]) => {
        if (typeOnly || !/(^|\/)game\/turnSchedule(\.ts)?$/.test(spec)) return false;
        return bindings.startsWith("*") || bindings.slice(1, -1).split(",").some((b) => b.trim().split(/\s+as\s+/)[0] === "turnSchedule");
      })
    )
    .map(([file]) => file)
    .sort();
}

test("turnSchedule is read by the server's turn and the offline driver, and nothing else", () => {
  const sources = sourcesUnder(root, PRODUCTION);
  assert.ok(sources.length > 200, `scanned only ${sources.length} production files`);
  assert.deepEqual(importers(sources), [["context", "offlineDriver.ts"].join("/"), ["server", "game", "gameTurn.ts"].join("/")]);
});

test("probe: a planted third caller is found, by either import style, and a type or constant import is not", () => {
  const at = (...parts: string[]) => parts.join("/");
  const planted: [string, string][] = [
    [at("components", "a.tsx"), 'import { BOT_THINK_MS, turnSchedule } from "@/lib/game/turnSchedule";'],
    [at("server", "b.ts"), 'import * as schedule from "../lib/game/turnSchedule.ts";'],
    [at("lib", "c.ts"), 'import { turnSchedule as when } from "./game/turnSchedule.ts";'],
    [at("lib", "d.ts"), 'import type { Gate } from "../game/turnSchedule.ts";'],
    [at("server", "e.ts"), 'import { BOT_THINK_MS } from "../lib/game/turnSchedule.ts";'],
  ];
  assert.deepEqual(importers(planted), [at("components", "a.tsx"), at("lib", "c.ts"), at("server", "b.ts")]);
});
