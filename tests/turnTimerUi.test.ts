// The turn's own clock, and the two controls that read it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canPassNow,
  playButtonLabel,
  turnTimerActive,
  urgentThresholdSeconds,
  URGENT_TICK_SECONDS,
  type ComboShape,
} from "../components/turnTimerUi.ts";


describe("canPassNow", () => {
  test("you may pass when answering someone else's combination", () => {
    assert.equal(canPassNow({ isMyTurn: true, isFinished: false, isNewRound: false }), true);
  });

  test("leading a round is compulsory — you cannot pass", () => {
    assert.equal(canPassNow({ isMyTurn: true, isFinished: false, isNewRound: true }), false);
  });

  test("not your turn, or already out: never", () => {
    assert.equal(canPassNow({ isMyTurn: false, isFinished: false, isNewRound: false }), false);
    assert.equal(canPassNow({ isMyTurn: true, isFinished: true, isNewRound: false }), false);
  });
});

describe("playButtonLabel", () => {
  const shape = (type: ComboShape["type"], length: number): ComboShape => ({ type, length });

  // A pair offered against a pair it cannot beat: the one case that really is
  // "too low", and the baseline every other case varies from.
  const base = {
    isMyTurn: true,
    isFinished: false,
    selectedCount: 2,
    selection: shape("pair", 2),
    pile: shape("pair", 2),
    requiresStartCard: false,
    selectionHasStartCard: false,
  };

  test("idle states read as a plain GIOCA", () => {
    assert.equal(playButtonLabel({ ...base, isMyTurn: false }), "play");
    assert.equal(playButtonLabel({ ...base, isFinished: true }), "play");
    assert.equal(playButtonLabel({ ...base, selectedCount: 0 }), "play");
  });

  test("an unrecognised selection says so", () => {
    assert.equal(playButtonLabel({ ...base, selection: null }), "notACombination");
  });

  test("the same shape, genuinely lower, is the only case called too low", () => {
    assert.equal(playButtonLabel(base), "tooLow");
  });

  test("a different shape is not too low — it is the wrong type", () => {
    assert.equal(
      playButtonLabel({ ...base, selection: shape("pair", 2), pile: shape("single", 1) }),
      "wrongType"
    );
  });

  test("the right type at the wrong length is neither too low nor the wrong type", () => {
    assert.equal(
      playButtonLabel({
        ...base,
        selection: shape("straight", 5),
        pile: shape("straight", 6),
      }),
      "wrongLength"
    );
  });

  test("only a higher bomb answers a bomb", () => {
    assert.equal(
      playButtonLabel({ ...base, selection: shape("straight", 5), pile: shape("bomb", 4) }),
      "bombOnly"
    );
    // Bomb against bomb is a real strength comparison, so that one is too low.
    assert.equal(
      playButtonLabel({ ...base, selection: shape("bomb", 4), pile: shape("bomb", 4) }),
      "tooLow"
    );
  });

  test("a royal straight is unanswerable, bomb included", () => {
    assert.equal(
      playButtonLabel({ ...base, selection: shape("pair", 2), pile: shape("royal_straight", 5) }),
      "royalUnbeatable"
    );
    assert.equal(
      playButtonLabel({ ...base, selection: shape("bomb", 4), pile: shape("royal_straight", 5) }),
      "royalUnbeatable"
    );
  });

  test("a royal straight answered by a shorter one is a length problem", () => {
    assert.equal(
      playButtonLabel({
        ...base,
        selection: shape("royal_straight", 5),
        pile: shape("royal_straight", 6),
      }),
      "wrongLength"
    );
  });

  test("the opening play without the start card is told exactly that", () => {
    // The empty table used to report "too low" here, contradicting the banner
    // in the middle of the same screen.
    assert.equal(
      playButtonLabel({ ...base, pile: null, requiresStartCard: true, selectionHasStartCard: false }),
      "needsStartCard"
    );
    assert.equal(
      playButtonLabel({ ...base, pile: null, requiresStartCard: true, selectionHasStartCard: true }),
      "play"
    );
  });

  test("not-my-turn wins over an unbuildable selection (no false accusation)", () => {
    assert.equal(playButtonLabel({ ...base, isMyTurn: false, selection: null }), "play");
  });
});

describe("turnTimerActive", () => {
  const base = {
    isMyTurn: true,
    isFinished: false,
    isNewRound: false,
    gameOver: false,
    exchangeActive: false,
    includeNewRound: false,
  };

  test("runs while answering a combination on your turn", () => {
    assert.equal(turnTimerActive(base), true);
  });

  test("offline: leading a new round has no deadline", () => {
    assert.equal(turnTimerActive({ ...base, isNewRound: true }), false);
  });

  test("online: the server AFK window covers leading too", () => {
    assert.equal(
      turnTimerActive({ ...base, isNewRound: true, includeNewRound: true }),
      true
    );
  });

  test("never during the exchange, after the game, or when it is not your turn", () => {
    assert.equal(turnTimerActive({ ...base, exchangeActive: true }), false);
    assert.equal(turnTimerActive({ ...base, gameOver: true }), false);
    assert.equal(turnTimerActive({ ...base, isMyTurn: false }), false);
    assert.equal(turnTimerActive({ ...base, isFinished: true }), false);
  });

  test("includeNewRound never overrides the harder stops", () => {
    assert.equal(
      turnTimerActive({ ...base, includeNewRound: true, exchangeActive: true }),
      false
    );
  });

  test("an announcement holding the table stops a clock this client owns", () => {
    // The floor: without the hold the same case runs, so this is about the
    // hold and not about some other stop already covering it.
    assert.equal(turnTimerActive({ ...base, includeNewRound: true }), true);
    assert.equal(
      turnTimerActive({ ...base, includeNewRound: true, announcementHolds: true }),
      false
    );
  });

  test("…and the caller says so, because a pause a server is not keeping is a lie", () => {
    // Online the deadline is the server's: `app/(online)/game.tsx` passes no
    // `pausable`, so the hold never reaches here and the clock keeps running.
    assert.equal(
      turnTimerActive({ ...base, includeNewRound: true, announcementHolds: false }),
      true
    );
  });
});


describe("urgentThresholdSeconds", () => {
  test("the shorter offline clock turns red well before the last five seconds", () => {
    // 20s offline: five seconds' warning on a clock that short arrives too
    // late to choose a card with.
    assert.equal(urgentThresholdSeconds(20), 8);
    assert.ok(urgentThresholdSeconds(20) > URGENT_TICK_SECONDS);
  });

  test("the longer online clock warns proportionally, not identically", () => {
    assert.equal(urgentThresholdSeconds(30), 12);
  });

  test("a very short clock never warns later than the audible tick", () => {
    assert.equal(urgentThresholdSeconds(6), URGENT_TICK_SECONDS);
    assert.equal(urgentThresholdSeconds(0), URGENT_TICK_SECONDS);
  });

  test("the threshold is a whole number of seconds — the countdown is integer", () => {
    for (const clock of [7, 13, 20, 25, 30, 45]) {
      assert.equal(urgentThresholdSeconds(clock) % 1, 0, `clock ${clock}`);
    }
  });
});
