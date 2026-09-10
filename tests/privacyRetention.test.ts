// tests/privacyRetention.test.ts — docs/PRIVACY.md states a retention window for
// each thing the service stores, and every one of those windows is also a
// constant. Nothing makes the two agree: changing REPLAY_RETENTION_DAYS leaves
// the document saying 14 days, still green, and now a false statement in a
// policy written to be published. Each case derives its figure from the
// constant and fails if the document has stopped saying it.
//
// The constants are read out of their source rather than imported: every module
// holding one also opens the database at import, and a docs check that needs a
// live pool is a docs check nobody can run.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const POLICY = readFileSync("docs/PRIVACY.md", "utf8");

/**
 * Reads `export const NAME = <arithmetic>` from a source file. The expression
 * is checked against a digits-and-operators pattern before being evaluated, so
 * this cannot run whatever else happens to be in the file.
 */
function constantFrom(file: string, name: string): number {
  const source = readFileSync(file, "utf8");
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `${file} no longer exports ${name}`);

  const expression = match[1].trim();
  assert.match(
    expression,
    /^[\d_\s*+()]+$/,
    `${name} in ${file} is no longer a plain arithmetic literal, so this check can no longer read it`
  );
  return Number(new Function(`return ${expression.replace(/_/g, "")}`)());
}

const hours = (ms: number) => ms / 3_600_000;
const days = (ms: number) => ms / 86_400_000;

describe("docs/PRIVACY.md states the retention the code enforces", () => {
  const cases: [string, () => string][] = [
    ["replays", () => `${constantFrom("lib/replay.ts", "REPLAY_RETENTION_DAYS")} days`],
    [
      "crash reports",
      () => `${constantFrom("server/clientErrors.ts", "CLIENT_ERROR_RETENTION_DAYS")} days`,
    ],
    [
      "bug reports",
      () => `${constantFrom("server/bugReports.ts", "BUG_REPORT_RETENTION_DAYS")} days`,
    ],
    ["usage events", () => `${constantFrom("server/events.ts", "EVENT_RETENTION_DAYS")} days`],
    [
      "stale rooms",
      () => `${hours(constantFrom("server/gamePersistence.ts", "STALE_ROOM_MAX_AGE_MS"))} hours`,
    ],
    [
      "abandoned games",
      () => `${hours(constantFrom("server/gamePersistence.ts", "ABANDONED_GAME_MAX_AGE_MS"))} hours`,
    ],
    [
      "the session cookie",
      () => `${days(constantFrom("server/session.ts", "SESSION_MAX_AGE_MS"))} days`,
    ],
  ];

  for (const [what, figure] of cases) {
    test(`${what}`, () => {
      const stated = figure();
      assert.ok(
        POLICY.includes(stated),
        `docs/PRIVACY.md no longer says "${stated}" for ${what}. The constant moved; the policy did not.`
      );
    });
  }

  test("the device cap is spelled out", () => {
    const cap = constantFrom("server/push.ts", "MAX_DEVICES_PER_USER");
    const spelled = ["zero", "one", "two", "three", "four", "five", "six"][cap];
    assert.ok(spelled, `MAX_DEVICES_PER_USER is ${cap}, which this check cannot spell`);
    assert.ok(
      POLICY.includes(`your ${spelled} most recent`),
      `docs/PRIVACY.md no longer says "your ${spelled} most recent" devices (MAX_DEVICES_PER_USER = ${cap}).`
    );
  });
});
