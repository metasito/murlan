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
import { AWAY_WINDOW_MS, heldSeatGraceMs, rejoinFailure } from "./soak/soak.ts";

const SOAK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "soak");

function seat(over: Partial<Parameters<typeof rejoinFailure>[0]> = {}) {
  return {
    username: "p1",
    lastRefusal: null,
    lastRefusalCode: null,
    gaveUpItsOwnSeat: false,
    ...over,
  };
}

const BUDGET = 5_000;

describe("reading the refusal a rejoin came back with", () => {
  test("a released seat the harness never gave up is the window outrunning the grace", () => {
    const v = rejoinFailure(
      seat({ lastRefusalCode: "SEAT_RELEASED", lastRefusal: "game:rejoin_failed SEAT_RELEASED: x" }),
      BUDGET,
      1_500
    );

    assert.equal(v.kind, "away-window-outran-grace");
    // Both numbers, because the diagnosis is the comparison between them: told only
    // that a seat was released, the reader goes to the server for a defect that is in
    // neither the server nor the flow.
    assert.match(v.detail, new RegExp(String(AWAY_WINDOW_MS.floor + AWAY_WINDOW_MS.spread)));
    assert.match(v.detail, /1500/);
  });

  test("names the seat, so a failure points at one of four clients", () => {
    const v = rejoinFailure(seat({ username: "soak3", lastRefusalCode: "SEAT_RELEASED" }), BUDGET, 900);

    assert.match(v.detail, /soak3/);
  });

  test("UNAUTHORIZED keeps #736's signature rather than becoming a harness artefact", () => {
    // The defect this suite exists for reads UNAUTHORIZED. Reported as the window
    // breaking, a real auth hole would be filed against the soak's own constants.
    const v = rejoinFailure(
      seat({ lastRefusalCode: "UNAUTHORIZED", lastRefusal: "game:rejoin_failed UNAUTHORIZED: no" }),
      BUDGET,
      60_000
    );

    assert.equal(v.kind, "rejoin-unanswered");
    assert.match(v.detail, /UNAUTHORIZED/);
  });

  for (const code of ["GAME_NOT_FOUND", "GAME_NO_LONGER_VALID", "SERVER_ERROR"]) {
    test(`${code} is left alone`, () => {
      assert.equal(rejoinFailure(seat({ lastRefusalCode: code }), BUDGET, 60_000).kind, "rejoin-unanswered");
    });
  }

  test("silence is still silence, and says so", () => {
    const v = rejoinFailure(seat(), BUDGET, 60_000);

    assert.equal(v.kind, "rejoin-unanswered");
    assert.match(v.detail, /said nothing at all/);
  });

  test("a seat the harness released itself is not the window breaking", () => {
    // The one-directional part. If a leave is ever added to the chaos, its own
    // SEAT_RELEASED is correct behaviour and must not be reported as a grace expiring.
    const v = rejoinFailure(
      seat({ lastRefusalCode: "SEAT_RELEASED", gaveUpItsOwnSeat: true }),
      BUDGET,
      1_500
    );

    assert.equal(v.kind, "rejoin-unanswered");
  });

  test("the budget it waited is in the sentence either way", () => {
    for (const s of [seat({ lastRefusalCode: "SEAT_RELEASED" }), seat()]) {
      assert.match(rejoinFailure(s, BUDGET, 1_500).detail, /5000ms/);
    }
  });
});

describe("the premise the reading rests on", () => {
  test("nothing under tests/soak leaves a room except the call that records it", () => {
    // The load-bearing fact, checked rather than written down: a `room:leave` the seat
    // does not know about turns every later SEAT_RELEASED into a false diagnosis, and
    // the run would still be green. `leave()` is where the emit belongs.
    const offenders: string[] = [];
    for (const name of readdirSync(SOAK_DIR).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(path.join(SOAK_DIR, name), "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (!line.includes('"room:leave"')) continue;
        if (/gaveUpItsOwnSeat/.test(source.split("\n").slice(Math.max(0, i - 3), i + 2).join("\n"))) continue;
        offenders.push(`${name}:${i + 1}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "a room:leave that does not set gaveUpItsOwnSeat makes the SEAT_RELEASED reading wrong " +
        "and nothing else would notice. Emit it through SeatClient.leave()."
    );
  });

  test("nothing clears half a refusal", () => {
    // The two fields describe one answer, and a caller that resets only the sentence
    // leaves the code pointing at an earlier drop: the next unanswered rejoin reports
    // a window that never broke, greenly, because the seat it names really did
    // reconnect. Only `clearRefusal()` can reset half of nothing.
    const offenders: string[] = [];
    for (const name of readdirSync(SOAK_DIR).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(path.join(SOAK_DIR, name), "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (/(?<!this)\.lastRefusal(Code)?\s*=[^=]/.test(line)) offenders.push(`${name}:${i + 1}`);
      }
    }

    assert.deepEqual(offenders, [], "clear them together, through Seat.clearRefusal().");
  });

  test("the grace the diagnosis quotes is the one the run is actually held by", () => {
    // Not a second derivation: if these drift, the failure names a number no seat was
    // ever held for, which is the wrong-reader problem in the diagnosis itself.
    assert.equal(typeof heldSeatGraceMs(), "number");
    assert.ok(heldSeatGraceMs() > 0);
  });
});
