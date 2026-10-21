// tests/server/privacyRetention.test.ts — docs/PRIVACY.md states a retention window for
// each thing the service stores, and every one of those windows is also a
// constant. Nothing makes the two agree: changing REPLAY_RETENTION_DAYS leaves
// the document saying 14 days, still green, and now a false statement in a
// policy written to be published. Each case derives its figure from the
// constant and fails if the document has stopped saying it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REPLAY_RETENTION_DAYS } from "../../lib/game/replay.ts";
import { CLIENT_ERROR_RETENTION_DAYS } from "../../server/http/clientErrors.ts";
import { SERVER_ERROR_RETENTION_DAYS } from "../../server/http/serverErrors.ts";
import { BUG_REPORT_RETENTION_DAYS } from "../../server/http/bugReports.ts";
import { EVENT_RETENTION_DAYS } from "../../server/shared/events.ts";
import { STALE_ROOM_MAX_AGE_MS, ABANDONED_GAME_MAX_AGE_MS } from "../../server/game/retention.ts";
import { SESSION_MAX_AGE_MS } from "../../server/http/session.ts";
import { MAX_DEVICES_PER_USER } from "../../server/socket/push.ts";

const POLICY = readFileSync("docs/PRIVACY.md", "utf8");

const hours = (ms: number) => ms / 3_600_000;
const days = (ms: number) => ms / 86_400_000;

describe("docs/PRIVACY.md states the retention the code enforces", () => {
  const cases: [string, () => string][] = [
    ["replays", () => `${REPLAY_RETENTION_DAYS} days`],
    ["crash reports", () => `${CLIENT_ERROR_RETENTION_DAYS} days`],
    ["server error records", () => `${SERVER_ERROR_RETENTION_DAYS} days`],
    ["bug reports", () => `${BUG_REPORT_RETENTION_DAYS} days`],
    ["usage events", () => `${EVENT_RETENTION_DAYS} days`],
    ["stale rooms", () => `${hours(STALE_ROOM_MAX_AGE_MS)} hours`],
    ["abandoned games", () => `${hours(ABANDONED_GAME_MAX_AGE_MS)} hours`],
    ["the session cookie", () => `${days(SESSION_MAX_AGE_MS)} days`],
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

  test("database backups", () => {
    const source = readFileSync("scripts/prune-backups.mjs", "utf8");
    const match = source.match(/BACKUP_RETENTION_DAYS \?\? "(\d+)"/);
    assert.ok(match, "scripts/prune-backups.mjs no longer reads BACKUP_RETENTION_DAYS with a literal default");
    const stated = `${match[1]} days after each is made`;
    assert.ok(
      POLICY.includes(`| Database backups | ${stated}`) && POLICY.includes(`deleted, ${match[1]} days after it was made`),
      `docs/PRIVACY.md no longer says "${stated}" for database backups, in both the table and the deletion paragraph.`
    );
  });

  test("the device cap is spelled out", () => {
    const cap = MAX_DEVICES_PER_USER;
    const spelled = ["zero", "one", "two", "three", "four", "five", "six"][cap];
    assert.ok(spelled, `MAX_DEVICES_PER_USER is ${cap}, which this check cannot spell`);
    assert.ok(
      POLICY.includes(`your ${spelled} most recent`),
      `docs/PRIVACY.md no longer says "your ${spelled} most recent" devices (MAX_DEVICES_PER_USER = ${cap}).`
    );
  });
});
