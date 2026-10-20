// The felt never leaves the window (#101); the deal's breath is the one thing that moves it.
// Which children the root holds is `tests/native/tableVeils.test.tsx`'s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments } from "../helpers/sourceScan.ts";
import { dealBreath } from "../../components/table/dealPose.ts";
import { Motion } from "../../lib/tokens.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the felt's breath only scales it, never below 1, so no edge of the window shows", () => {
  const source = readFileSync(path.join(repoRoot, "components", "GameTable.tsx"), "utf8");
  assert.match(source, /const breathStyle = useDealBreath\(/);
  const deal = blankComments(readFileSync(path.join(repoRoot, "components", "table", "deal.tsx"), "utf8"));
  const body = deal.slice(deal.indexOf("export function useDealBreath"));
  const style = /useAnimatedStyle\(\(\) => \((\{[^\n]*\})\)\)/.exec(body)?.[1] ?? "";
  assert.match(style, /^\{ transform: \[\{ scale: [^\]{}]*dealBreath\([^\]{}]*\}\] \}$/, `the breath's style is no longer a scale from dealBreath alone: ${style}`);
  for (let since = -20; since <= 120; since += 0.5) {
    assert.ok(dealBreath(since, Motion.deal.breath) >= 1, `the breath shrinks the felt at ${since} ms`);
  }
});
