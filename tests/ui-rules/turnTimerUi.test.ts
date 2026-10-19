// The turn's own clock, and the two controls that read it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canPassNow,
  turnTimerActive,
  urgentThresholdSeconds,
  pulseRepeats,
  CLOCK_RUNNING_OUT_SECONDS,
} from "../../components/turnTimerUi.ts";


describe("canPassNow", () => {
  test("you may pass when answering someone else's combination", () => {
    assert.equal(canPassNow({ isMyTurn: true, isFinished: false, isNewTrick: false }), true);
  });

  test("leading a round is compulsory — you cannot pass", () => {
    assert.equal(canPassNow({ isMyTurn: true, isFinished: false, isNewTrick: true }), false);
  });

  test("not your turn, or already out: never", () => {
    assert.equal(canPassNow({ isMyTurn: false, isFinished: false, isNewTrick: false }), false);
    assert.equal(canPassNow({ isMyTurn: true, isFinished: true, isNewTrick: false }), false);
  });
});

describe("turnTimerActive", () => {
  const base = {
    isMyTurn: true,
    isFinished: false,
    isNewTrick: false,
    roundOver: false,
    exchangeActive: false,
    includeNewTrick: false,
  };

  test("runs while answering a combination on your turn", () => {
    assert.equal(turnTimerActive(base), true);
  });

  test("offline: leading a new round has no deadline", () => {
    assert.equal(turnTimerActive({ ...base, isNewTrick: true }), false);
  });

  test("online: the server AFK window covers leading too", () => {
    assert.equal(
      turnTimerActive({ ...base, isNewTrick: true, includeNewTrick: true }),
      true
    );
  });

  test("never during the exchange, after the game, or when it is not your turn", () => {
    assert.equal(turnTimerActive({ ...base, exchangeActive: true }), false);
    assert.equal(turnTimerActive({ ...base, roundOver: true }), false);
    assert.equal(turnTimerActive({ ...base, isMyTurn: false }), false);
    assert.equal(turnTimerActive({ ...base, isFinished: true }), false);
  });

  test("includeNewTrick never overrides the harder stops", () => {
    assert.equal(
      turnTimerActive({ ...base, includeNewTrick: true, exchangeActive: true }),
      false
    );
  });

  test("an announcement holding the table stops a clock this client owns", () => {
    // The floor: without the hold the same case runs, so this is about the
    // hold and not about some other stop already covering it.
    assert.equal(turnTimerActive({ ...base, includeNewTrick: true }), true);
    assert.equal(
      turnTimerActive({ ...base, includeNewTrick: true, announcementHolds: true }),
      false
    );
  });

  test("…and the caller says so, because a pause a server is not keeping is a lie", () => {
    // Online the deadline is the server's: `app/(online)/game.tsx` passes no
    // `pausable`, so the hold never reaches here and the clock keeps running.
    assert.equal(
      turnTimerActive({ ...base, includeNewTrick: true, announcementHolds: false }),
      true
    );
  });
});


describe("urgentThresholdSeconds", () => {
  test("a short clock turns red well before the last five seconds", () => {
    // 20s: five seconds' warning on a clock that short arrives too late to
    // choose a card with.
    assert.equal(urgentThresholdSeconds(20), 8);
    assert.ok(urgentThresholdSeconds(20) > CLOCK_RUNNING_OUT_SECONDS);
  });

  test("a longer clock warns proportionally, not identically", () => {
    assert.equal(urgentThresholdSeconds(30), 12);
  });

  test("a very short clock never warns later than the audible tick", () => {
    assert.equal(urgentThresholdSeconds(6), CLOCK_RUNNING_OUT_SECONDS);
    assert.equal(urgentThresholdSeconds(0), CLOCK_RUNNING_OUT_SECONDS);
  });

  test("the threshold is a whole number of seconds — the countdown is integer", () => {
    for (const clock of [7, 13, 20, 25, 30, 45]) {
      assert.equal(urgentThresholdSeconds(clock) % 1, 0, `clock ${clock}`);
    }
  });
});

describe("pulseRepeats", () => {
  test("a clock already out of time arms no pulse, since a count of 0 would repeat forever", () => {
    assert.equal(pulseRepeats(4000, 0), 0);
  });

  test("counts a beat a second across the urgent stretch, rounding a partial beat up", () => {
    assert.equal(pulseRepeats(4000, 10_000), 4);
    assert.equal(pulseRepeats(4000, 2500), 3);
    assert.equal(pulseRepeats(4000, 1), 1);
  });
});
