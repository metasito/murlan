// tests/soakAwayWindow.test.ts — the soak's chaos must stay inside the grace it reads against.
//
// The soak drops a seat and reconnects it, and calls an unanswered `game:rejoin` a violation.
// That reading is only true while the seat still exists. Past the grace the server releases
// it correctly and the same violation names working behaviour, with the refusal reading
// `UNAUTHORIZED` either way — #736 was found on the right side of this line, and would have
// been indistinguishable from a harness artefact on the wrong one.
//
// Two graces govern it, and the shorter one is what binds: a drop always starts mid-hand, so
// `disconnectGraceMs()` arms first, but the hand can end while the seat is away and a seat
// between hands is held by `lobbyGraceMs()` instead. Neither lives in this file, and nothing
// else says the window depends on them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AWAY_WINDOW_MS, awayWindowOutsideGrace, heldSeatGraceMs } from "./soak/soak.ts";
import { disconnectGraceMs, lobbyGraceMs } from "../server/gameTimers.ts";

const longest = AWAY_WINDOW_MS.floor + AWAY_WINDOW_MS.spread;

describe("the soak's away window", () => {
  test("is inside the grace the server actually holds a dropped seat for", () => {
    assert.equal(
      awayWindowOutsideGrace(AWAY_WINDOW_MS, heldSeatGraceMs()),
      null,
      "the soak reports an unanswered rejoin as a defect, which it is only while the seat is held"
    );
  });

  test("reads whichever grace can expire first", () => {
    // Binding to one of them names the wrong timer for half the drops: a seat lost mid-hand
    // is held by the disconnect grace, and the same seat is held by the lobby grace the
    // moment the hand ends underneath it.
    assert.equal(heldSeatGraceMs(), Math.min(disconnectGraceMs(), lobbyGraceMs()));
  });

  for (const [which, grace] of [
    ["disconnect", disconnectGraceMs()],
    ["lobby", lobbyGraceMs()],
  ] as const) {
    test(`catches a window past the ${which} grace`, () => {
      const window = { floor: grace, spread: 1 };
      const message = awayWindowOutsideGrace(window, grace);
      assert.ok(message, `a window longer than the ${which} grace was not caught`);
      assert.match(String(message), new RegExp(String(window.floor + window.spread)));
      assert.match(String(message), new RegExp(String(grace)));
    });
  }

  test("catches a window that fits the grace with no room for the reconnect", () => {
    // The sleep is not the time away: the server's clock also covers the ticket fetch and the
    // handshake that follow it, and the window is not scaled on CI where everything else is.
    // A window that merely fits is one this cannot vouch for.
    assert.ok(awayWindowOutsideGrace({ floor: 999, spread: 1 }, 1_000));
  });

  test("allows a window with room to spare", () => {
    assert.equal(awayWindowOutsideGrace({ floor: 99, spread: 1 }, 1_000), null);
  });

  test("leaves the window room to be retuned before it becomes a problem", () => {
    // The floor. A check that only just passes is one edit from failing, and this one exists
    // to be edited — the window is chaos, and chaos gets retuned.
    assert.ok(
      longest * 8 < heldSeatGraceMs(),
      `the away window is ${longest}ms against a ${heldSeatGraceMs()}ms grace, which is close ` +
        "enough that a routine widening crosses it"
    );
  });
});
