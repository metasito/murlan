// tests/bots/botSearchTimeoutScan.test.ts — the source scans split out of botSearchTimeout.test.ts so the mutation run keeps that file's behaviour tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_SEARCH_MS } from "../e2e/helpers/bot.ts";
import { blankComments } from "../helpers/sourceScan.ts";
import { TURN_TIMEOUT_MS } from "../../lib/game/gameEngine.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A numeric `const` read out of source, because the declaring module cannot be imported here. */
function sourceConstant(relPath: string, name: string): number {
  const source = blankComments(readFileSync(path.join(repoRoot, relPath), "utf8"));
  const found = source.match(new RegExp(`\\b${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(found, `${relPath} no longer declares a numeric ${name}`);
  return Number(found[1].replace(/_/g, ""));
}

test("tableFit's offline clock has not drifted from HUMAN_TURN_SECONDS", () => {
  const game = blankComments(readFileSync(path.join(repoRoot, "context/offlineDriver.ts"), "utf8"));
  assert.match(game, /\bHUMAN_TURN_SECONDS\s*=\s*TURN_TIMEOUT_MS\s*\/\s*1_?000\s*;/);
  assert.equal(
    sourceConstant("tests/e2e/tableFit.spec.ts", "OFFLINE_CLOCK_MS"),
    TURN_TIMEOUT_MS,
    "tests/e2e/tableFit.spec.ts's OFFLINE_CLOCK_MS has drifted from HUMAN_TURN_SECONDS"
  );
});

test("DEFAULT_MAX_SEARCH_MS stays under driveGameToCompletion's own maxTotalMs default", () => {
  const source = blankComments(
    readFileSync(path.join(repoRoot, "tests/e2e/helpers/bot.ts"), "utf8")
  );
  const found = source.match(/maxTotalMs\s*=\s*opts\.maxTotalMs\s*\?\?\s*([0-9_]+)/);
  assert.ok(found, "driveGameToCompletion no longer declares maxTotalMs's default this way");
  const maxTotalMsDefault = Number(found[1].replace(/_/g, ""));

  assert.ok(
    DEFAULT_MAX_SEARCH_MS < maxTotalMsDefault,
    `DEFAULT_MAX_SEARCH_MS (${DEFAULT_MAX_SEARCH_MS}ms) must stay under maxTotalMs's default ` +
      `(${maxTotalMsDefault}ms), or a runaway search reports as "the whole game stalled" with ` +
      `none of SearchTimeoutError's own diagnostic`
  );
});
