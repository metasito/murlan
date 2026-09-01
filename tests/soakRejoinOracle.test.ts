// tests/soakRejoinOracle.test.ts — what an unanswered rejoin is evidence of.
//
// `tests/soakAwayWindow.test.ts` keeps the away window a safe multiple under the shortest
// grace, so the oracle's reading stays true. That check compares two constants before the
// run starts and cannot see the run: a stalled runner, a paused container, a GC pause or a
// grace lowered by a config the soak never reads all break the premise while it still passes.
//
// `SEAT_RELEASED` makes the same claim checkable at runtime — but it is not "a grace
// expired". Four routes reach it through `vacateSeat`, and two of them (a deliberate
// `room:leave`, a deleted account) involve no grace at all. What makes the reading sound is
// that the harness never gives a seat up itself, and that fact is carried by the seat rather
// than assumed: `leave()` is the only way to emit `room:leave`, and it records that it did.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AWAY_WINDOW_MS, REJOIN_BUDGET_MS, heldSeatGraceMs, rejoinFailure } from "./soak/soak.ts";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOAK_DIR = path.join(TESTS_DIR, "soak");

/**
 * Every file that holds a `Seat`, found rather than listed: `Seat.socket` is
 * public, so the guards below are only as wide as the set of files that can
 * reach it, and a new one added to a list nobody updates is the failure this
 * whole ticket is about.
 */
function filesHoldingASeat(): string[] {
  const found = readdirSync(SOAK_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(SOAK_DIR, f));
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && full !== fileURLToPath(import.meta.url)) {
        if (/from "\.{1,2}\/(soak\/)?soak\.ts"/.test(readFileSync(full, "utf8"))) found.push(full);
      }
    }
  };
  walk(TESTS_DIR);
  return [...new Set(found)];
}

/** Lines matching `pattern` in those files, minus any the exemption forgives. */
function scan(
  pattern: RegExp,
  exempt: (line: string, source: string[], i: number) => boolean = () => false
): string[] {
  const offenders: string[] = [];
  for (const file of filesHoldingASeat()) {
    const source = readFileSync(file, "utf8").split("\n");
    for (const [i, line] of source.entries()) {
      if (pattern.test(line) && !exempt(line, source, i)) {
        offenders.push(`${path.relative(TESTS_DIR, file)}:${i + 1}`);
      }
    }
  }
  return offenders;
}

function seat(over: Partial<Parameters<typeof rejoinFailure>[0]> = {}) {
  return {
    username: "p1",
    lastRefusal: null,
    lastRefusalCode: null,
    gaveUpItsOwnSeat: false,
    ...over,
  };
}

const AWAY_MS = 4_211;

describe("reading the refusal a rejoin came back with", () => {
  test("a released seat the harness never gave up is the window outrunning the grace", () => {
    const v = rejoinFailure(
      seat({ lastRefusalCode: "SEAT_RELEASED", lastRefusal: "game:rejoin_failed SEAT_RELEASED: x" }),
      AWAY_MS
    );

    assert.equal(v.kind, "away-window-outran-grace");
    // Both numbers, because the diagnosis is the comparison between them and neither
    // side of it is safe to assume: away the longer, the release was right and
    // something stalled; away the shorter, the server let the seat go early. Told
    // only that a seat was released, the reader cannot tell those apart.
    assert.match(v.detail, new RegExp(`${AWAY_MS}ms`));
    assert.match(v.detail, new RegExp(`${heldSeatGraceMs()}ms`));
  });

  test("the away time is the one measured, never the window that was asked for", () => {
    // The run this fires on is by definition the one where the plan and the clock
    // disagree, so printing the plan prints the number already known to be wrong.
    const v = rejoinFailure(seat({ lastRefusalCode: "SEAT_RELEASED" }), AWAY_MS);

    assert.doesNotMatch(v.detail, new RegExp(String(AWAY_WINDOW_MS.floor + AWAY_WINDOW_MS.spread)));
  });

  test("names the seat, so a failure points at one of four clients", () => {
    const v = rejoinFailure(seat({ username: "soak3", lastRefusalCode: "SEAT_RELEASED" }), AWAY_MS);

    assert.match(v.detail, /soak3/);
  });

  test("UNAUTHORIZED keeps #736's signature rather than becoming a harness artefact", () => {
    // The defect this suite exists for reads UNAUTHORIZED. Reported as the window
    // breaking, a real auth hole would be filed against the soak's own constants.
    const v = rejoinFailure(
      seat({ lastRefusalCode: "UNAUTHORIZED", lastRefusal: "game:rejoin_failed UNAUTHORIZED: no" }),
      AWAY_MS
    );

    assert.equal(v.kind, "rejoin-unanswered");
    assert.match(v.detail, /UNAUTHORIZED/);
  });

  for (const code of ["GAME_NOT_FOUND", "GAME_NO_LONGER_VALID", "SERVER_ERROR"]) {
    test(`${code} is left alone`, () => {
      assert.equal(rejoinFailure(seat({ lastRefusalCode: code }), AWAY_MS).kind, "rejoin-unanswered");
    });
  }

  test("silence is still silence, and says so", () => {
    const v = rejoinFailure(seat(), AWAY_MS);

    assert.equal(v.kind, "rejoin-unanswered");
    assert.match(v.detail, /said nothing at all/);
  });

  test("a seat the harness released itself is not the window breaking", () => {
    // The one-directional part. If a leave is ever added to the chaos, its own
    // SEAT_RELEASED is correct behaviour and must not be reported as a grace expiring.
    const v = rejoinFailure(seat({ lastRefusalCode: "SEAT_RELEASED", gaveUpItsOwnSeat: true }), AWAY_MS);

    assert.equal(v.kind, "rejoin-unanswered");
  });

  test("the budget it waited is the runner's own, in the sentence either way", () => {
    // Taken from the module rather than repeated here: a copy of the number is a
    // second definition of it, and DEADLINE_SCALE moves the real one on CI.
    for (const s of [seat({ lastRefusalCode: "SEAT_RELEASED" }), seat()]) {
      assert.match(rejoinFailure(s, AWAY_MS).detail, new RegExp(`${REJOIN_BUDGET_MS}ms`));
    }
  });
});

describe("the premise the reading rests on", () => {
  test("no file holding a Seat leaves a room except through the call that records it", () => {
    // The load-bearing fact, checked rather than written down: a `room:leave` the seat
    // does not know about turns every later SEAT_RELEASED into a false diagnosis, and
    // the run would still be green. Unquoted, so a hoisted `const LEAVE = "room:leave"`
    // is caught too — `Seat.socket` is public, so the emit need not be in the class.
    const offenders = scan(/room:leave/, (line, source, i) =>
      /gaveUpItsOwnSeat/.test(source.slice(Math.max(0, i - 3), i + 2).join("\n"))
    );

    assert.deepEqual(
      offenders,
      [],
      "a room:leave that does not set gaveUpItsOwnSeat makes the SEAT_RELEASED reading wrong " +
        "and nothing else would notice. Emit it through Seat.leave()."
    );
  });

  test("nothing clears half a refusal", () => {
    // The two fields describe one answer, and a caller that resets only the sentence
    // leaves the code pointing at an earlier drop: the next unanswered rejoin reports
    // a window that never broke, greenly, because the seat it names really did
    // reconnect. Only `clearRefusal()` can reset half of nothing.
    const offenders = scan(/(?<!this)\.lastRefusal(Code)?\s*=[^=]/);

    assert.deepEqual(offenders, [], "clear them together, through Seat.clearRefusal().");
  });
});
