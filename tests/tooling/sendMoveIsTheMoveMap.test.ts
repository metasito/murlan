// `sendMove` is the one test-side map from a `Move` to its socket intent: a driver that spells the
// events out itself drifts from it the first time a move's payload changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { blankComments } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const MOVE_EVENT = /["'`]game:(?:play|pass|exchange_give_card)["'`]/g;
const HOME = "tests/helpers/client.ts";

function outsideSendMove(): string[] {
  const hits: string[] = [];
  for (const dir of ["tests/helpers", "tests/soak"]) {
    for (const f of readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })) {
      if (!/\.[cm]?[jt]sx?$/.test(f)) continue;
      const rel = path.posix.join(dir, f.split(path.sep).join("/"));
      const code = blankComments(readFileSync(path.join(repoRoot, rel), "utf8"));
      let start = -1;
      let end = -1;
      if (rel === HOME) {
        start = code.indexOf("export function sendMove(");
        end = code.indexOf("\n}\n", start);
      }
      for (const m of code.matchAll(MOVE_EVENT)) {
        if (m.index > start && m.index < end) continue;
        hits.push(`${rel}:${code.slice(0, m.index).split("\n").length} ${m[0]}`);
      }
    }
  }
  return hits;
}

test("sendMove is where a move becomes its event", () => {
  const home = readFileSync(path.join(repoRoot, HOME), "utf8");
  const body = home.slice(home.indexOf("export function sendMove("));
  for (const event of ["game:play", "game:pass", "game:exchange_give_card"]) {
    assert.ok(body.slice(0, body.indexOf("\n}\n")).includes(`"${event}"`), `sendMove no longer sends ${event}`);
  }
});

test("no helper or soak driver spells a move event outside sendMove", () => {
  assert.deepEqual(outsideSendMove(), [], "send the Move through sendMove instead");
});
