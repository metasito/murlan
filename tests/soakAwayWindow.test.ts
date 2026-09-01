// tests/soakAwayWindow.test.ts — the soak's chaos must stay inside the grace it reads against.
//
// The soak drops a seat and reconnects it, and calls an unanswered `game:rejoin` a violation.
// That reading is only true while the seat still exists: inside `lobbyGraceMs()` the server is
// holding it, so silence is a defect — #736 was found exactly this way. Past the grace the
// server releases the seat correctly, and the same violation would name working behaviour.
//
// Nothing about the away window says it depends on the grace, and the two are declared in
// different files. This is what stops them drifting apart.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AWAY_WINDOW_MS, awayWindowOutsideGrace } from "./soak/soak.ts";
import { lobbyGraceMs } from "../server/gameTimers.ts";

const longest = (w: typeof AWAY_WINDOW_MS) => w.floor + w.spread;

describe("the soak's away window", () => {
  test("is inside the grace the server actually holds a seat for", () => {
    assert.equal(
      awayWindowOutsideGrace(AWAY_WINDOW_MS, lobbyGraceMs()),
      null,
      "the soak reports an unanswered rejoin as a defect, which it is only while the seat is held"
    );
  });

  test("catches a window widened past the grace", () => {
    const grace = lobbyGraceMs();
    const message = awayWindowOutsideGrace({ floor: grace, spread: 1 }, grace);
    assert.ok(message, "a window longer than the grace was not caught");
    assert.match(String(message), new RegExp(String(grace)), "the message names neither number");
  });

  test("catches a window that merely reaches the grace", () => {
    // The seat is released *at* the grace, so equality is already the failing case: an oracle
    // that only fires past it hands the boundary run a violation it cannot explain.
    const grace = lobbyGraceMs();
    assert.ok(awayWindowOutsideGrace({ floor: grace - 1, spread: 1 }, grace));
  });

  test("leaves room to widen the window before it becomes a problem", () => {
    // The floor half of the rule: a check that only just passes is one edit from failing, and
    // this one exists to be edited — the window is chaos, and chaos gets retuned.
    assert.ok(
      longest(AWAY_WINDOW_MS) * 4 < lobbyGraceMs(),
      `the away window is ${longest(AWAY_WINDOW_MS)}ms against a ${lobbyGraceMs()}ms grace, ` +
        "which is close enough that a routine widening crosses it"
    );
  });
});
