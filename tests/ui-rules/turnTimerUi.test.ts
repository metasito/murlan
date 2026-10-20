// The turn's own clock, and the two controls that read it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canPassNow,
  turnTimerActive,
  urgentThresholdSeconds,
  pulseRepeats,
  CLOCK_RUNNING_OUT_SECONDS,
  turnPresentation,
} from "../../components/turnTimerUi.ts";
import { describeTableForA11y, type TableA11yStrings } from "../../components/tableA11y.ts";
import type { TFn } from "../../lib/i18n.ts";


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

/**
 * The turn chip over every input it reads. `viewerOnMove` is the shown turn being the
 * viewer's, still holding cards; a row with it set while the round is over or dealing is
 * left out, since the chip and the screen reader then read it as false.
 *
 * [roundOver, matchOver, dealing, viewerOnMove, exchangeChip, chip, spoken, lit, a11y]
 */
type Bit = 0 | 1;
const TURN_TABLE: [Bit, Bit, Bit, Bit, Bit, string, string, Bit, string][] = [
  [0, 0, 0, 0, 0, "gameShared.turnOf(Ana)", "gameTable.a11yTurnOf(Ana)", 0, "a11y.turnOf(Ana)"],
  [0, 0, 0, 0, 1, "CHIP", "CHIP", 1, "a11y.give(L)"],
  [0, 0, 0, 1, 0, "gameShared.yourTurn", "gameTable.a11yYourTurn", 1, "a11y.yourTurn"],
  [0, 0, 0, 1, 1, "CHIP", "CHIP", 1, "a11y.give(L)"],
  [0, 0, 1, 0, 0, "gameShared.dealing", "gameTable.a11yDealing", 0, "a11y.dealing"],
  [0, 0, 1, 0, 1, "CHIP", "CHIP", 1, "a11y.dealing"],
  [0, 1, 0, 0, 0, "gameShared.turnOf(Ana)", "gameTable.a11yTurnOf(Ana)", 0, "a11y.turnOf(Ana)"],
  [0, 1, 0, 0, 1, "CHIP", "CHIP", 1, "a11y.give(L)"],
  [0, 1, 0, 1, 0, "gameShared.yourTurn", "gameTable.a11yYourTurn", 1, "a11y.yourTurn"],
  [0, 1, 0, 1, 1, "CHIP", "CHIP", 1, "a11y.give(L)"],
  [0, 1, 1, 0, 0, "gameShared.dealing", "gameTable.a11yDealing", 0, "a11y.dealing"],
  [0, 1, 1, 0, 1, "CHIP", "CHIP", 1, "a11y.dealing"],
  [1, 0, 0, 0, 0, "gameShared.roundOver", "gameTable.a11yRoundOver", 0, "a11y.roundOver"],
  [1, 0, 0, 0, 1, "CHIP", "CHIP", 1, "a11y.roundOver"],
  [1, 0, 1, 0, 0, "gameShared.roundOver", "gameTable.a11yRoundOver", 0, "a11y.roundOver"],
  [1, 0, 1, 0, 1, "CHIP", "CHIP", 1, "a11y.roundOver"],
  [1, 1, 0, 0, 0, "gameShared.matchOver", "gameTable.a11yMatchOver", 0, "a11y.matchOver"],
  [1, 1, 0, 0, 1, "CHIP", "CHIP", 1, "a11y.matchOver"],
  [1, 1, 1, 0, 0, "gameShared.matchOver", "gameTable.a11yMatchOver", 0, "a11y.matchOver"],
  [1, 1, 1, 0, 1, "CHIP", "CHIP", 1, "a11y.matchOver"],
];

/**
 * Both timer questions over every input they read: `c` the viewer's chip counts down,
 * `s` the ring on the seat on move sweeps.
 *
 * Bits: isMyTurn, isFinished, isNewTrick, roundOver, exchangeActive, includeNewTrick, pausable, holdingForStart.
 */
const CLOCK_TABLE: string[] = [
  "00000000:-s 00000001:-s 00000010:-s 00000011:-- 00000100:-s 00000101:-s 00000110:-s 00000111:--",
  "00001000:-- 00001001:-- 00001010:-- 00001011:-- 00001100:-- 00001101:-- 00001110:-- 00001111:--",
  "00010000:-- 00010001:-- 00010010:-- 00010011:-- 00010100:-- 00010101:-- 00010110:-- 00010111:--",
  "00011000:-- 00011001:-- 00011010:-- 00011011:-- 00011100:-- 00011101:-- 00011110:-- 00011111:--",
  "00100000:-s 00100001:-s 00100010:-s 00100011:-- 00100100:-s 00100101:-s 00100110:-s 00100111:--",
  "00101000:-- 00101001:-- 00101010:-- 00101011:-- 00101100:-- 00101101:-- 00101110:-- 00101111:--",
  "00110000:-- 00110001:-- 00110010:-- 00110011:-- 00110100:-- 00110101:-- 00110110:-- 00110111:--",
  "00111000:-- 00111001:-- 00111010:-- 00111011:-- 00111100:-- 00111101:-- 00111110:-- 00111111:--",
  "01000000:-s 01000001:-s 01000010:-s 01000011:-- 01000100:-s 01000101:-s 01000110:-s 01000111:--",
  "01001000:-- 01001001:-- 01001010:-- 01001011:-- 01001100:-- 01001101:-- 01001110:-- 01001111:--",
  "01010000:-- 01010001:-- 01010010:-- 01010011:-- 01010100:-- 01010101:-- 01010110:-- 01010111:--",
  "01011000:-- 01011001:-- 01011010:-- 01011011:-- 01011100:-- 01011101:-- 01011110:-- 01011111:--",
  "01100000:-s 01100001:-s 01100010:-s 01100011:-- 01100100:-s 01100101:-s 01100110:-s 01100111:--",
  "01101000:-- 01101001:-- 01101010:-- 01101011:-- 01101100:-- 01101101:-- 01101110:-- 01101111:--",
  "01110000:-- 01110001:-- 01110010:-- 01110011:-- 01110100:-- 01110101:-- 01110110:-- 01110111:--",
  "01111000:-- 01111001:-- 01111010:-- 01111011:-- 01111100:-- 01111101:-- 01111110:-- 01111111:--",
  "10000000:cs 10000001:cs 10000010:cs 10000011:-- 10000100:cs 10000101:cs 10000110:cs 10000111:--",
  "10001000:-- 10001001:-- 10001010:-- 10001011:-- 10001100:-- 10001101:-- 10001110:-- 10001111:--",
  "10010000:-- 10010001:-- 10010010:-- 10010011:-- 10010100:-- 10010101:-- 10010110:-- 10010111:--",
  "10011000:-- 10011001:-- 10011010:-- 10011011:-- 10011100:-- 10011101:-- 10011110:-- 10011111:--",
  "10100000:-s 10100001:-s 10100010:-s 10100011:-- 10100100:cs 10100101:cs 10100110:cs 10100111:--",
  "10101000:-- 10101001:-- 10101010:-- 10101011:-- 10101100:-- 10101101:-- 10101110:-- 10101111:--",
  "10110000:-- 10110001:-- 10110010:-- 10110011:-- 10110100:-- 10110101:-- 10110110:-- 10110111:--",
  "10111000:-- 10111001:-- 10111010:-- 10111011:-- 10111100:-- 10111101:-- 10111110:-- 10111111:--",
  "11000000:-s 11000001:-s 11000010:-s 11000011:-- 11000100:-s 11000101:-s 11000110:-s 11000111:--",
  "11001000:-- 11001001:-- 11001010:-- 11001011:-- 11001100:-- 11001101:-- 11001110:-- 11001111:--",
  "11010000:-- 11010001:-- 11010010:-- 11010011:-- 11010100:-- 11010101:-- 11010110:-- 11010111:--",
  "11011000:-- 11011001:-- 11011010:-- 11011011:-- 11011100:-- 11011101:-- 11011110:-- 11011111:--",
  "11100000:-s 11100001:-s 11100010:-s 11100011:-- 11100100:-s 11100101:-s 11100110:-s 11100111:--",
  "11101000:-- 11101001:-- 11101010:-- 11101011:-- 11101100:-- 11101101:-- 11101110:-- 11101111:--",
  "11110000:-- 11110001:-- 11110010:-- 11110011:-- 11110100:-- 11110101:-- 11110110:-- 11110111:--",
  "11111000:-- 11111001:-- 11111010:-- 11111011:-- 11111100:-- 11111101:-- 11111110:-- 11111111:--",
];
const clockRows = CLOCK_TABLE.flatMap((line) => line.split(" ")).map((cell) => {
  const [bits, answer] = cell.split(":");
  const [isMyTurn, isFinished, isNewTrick, roundOver, exchangeActive, includeNewTrick, pausable, holdingForStart] = [...bits].map(
    (b) => b === "1"
  );
  return { isMyTurn, isFinished, isNewTrick, roundOver, exchangeActive, includeNewTrick, pausable, holdingForStart, answer };
});

const fakeT = ((key: string, params?: Record<string, unknown>) => (params ? `${key}(${params.name})` : key)) as TFn;
const a11yFirst: TableA11yStrings = {
  yourTurn: "a11y.yourTurn",
  turnOf: (name) => `a11y.turnOf(${name})`,
  emptyTable: "",
  youPlayed: () => "",
  playerPlayed: () => "",
  opponentCardCount: () => "",
  yourCardCount: () => "",
  exchangeGiveCard: (name) => `a11y.give(${name})`,
  exchangeWaitForCard: (name) => `a11y.wait(${name})`,
  roundOver: "a11y.roundOver",
  matchOver: "a11y.matchOver",
  dealing: "a11y.dealing",
};

describe("the turn chip and its clocks", () => {
  test("the tables cover every input", () => {
    assert.equal(TURN_TABLE.length, 20);
    assert.equal(new Set(TURN_TABLE.map((r) => r.slice(0, 5).join(""))).size, 20);
    assert.equal(clockRows.length, 256);
    assert.equal(new Set(clockRows.map((r) => JSON.stringify(r))).size, 256);
  });

  for (const [roundOver, matchOver, dealing, viewerOnMove, exchange, , , , a11y] of TURN_TABLE) {
    test(`a11y for ${[roundOver, matchOver, dealing, viewerOnMove, exchange].join("")}`, () => {
      const said = describeTableForA11y(
        {
          isMyTurn: viewerOnMove === 1,
          currentTurnName: "Ana",
          myCardCount: 0,
          lastPlay: null,
          opponents: [],
          roundOver: roundOver === 1,
          matchOver: matchOver === 1,
          dealing: dealing === 1,
          exchange: exchange
            ? { active: true, viewerIsWinner: true, viewerIsLoser: false, winnerName: "W", loserName: "L" }
            : undefined,
        },
        a11yFirst
      );
      assert.equal(said.split(" ")[0], a11y);
    });
  }

  const base = {
    onMoveName: "Ana",
    roundOver: false,
    matchOver: false,
    dealing: false,
    shownTurnIsMine: false,
    exchange: { chip: null, choiceOpen: false, viewerIsWinner: false, active: false },
    isMyTurn: false,
    isFinished: false,
    isNewTrick: false,
    holdingForStart: false,
    held: false,
    turnToken: "tok",
    t: fakeT,
  };

  for (const [roundOver, matchOver, dealing, viewerOnMove, exchange, chip, spoken, lit] of TURN_TABLE) {
    test(`chip for ${[roundOver, matchOver, dealing, viewerOnMove, exchange].join("")}`, () => {
      const shown = turnPresentation({
        ...base,
        roundOver: roundOver === 1,
        matchOver: matchOver === 1,
        dealing: dealing === 1,
        shownTurnIsMine: viewerOnMove === 1,
        exchange: exchange ? { chip: "CHIP", choiceOpen: true, viewerIsWinner: true, active: true } : base.exchange,
      }).chip;
      assert.deepEqual(shown, { text: chip, spoken, lit: lit === 1 });
    });
  }

  test("a viewer gone out is not on move, and the count is drawn while the deal flies", () => {
    const out = turnPresentation({ ...base, shownTurnIsMine: true, isFinished: true });
    assert.deepEqual([out.chip.text, out.chip.lit, out.clock.revealed], ["gameShared.turnOf(Ana)", false, false]);
    const dealing = turnPresentation({ ...base, shownTurnIsMine: true, dealing: true });
    assert.deepEqual([dealing.chip.text, dealing.chip.lit, dealing.clock.revealed], ["gameShared.dealing", false, true]);
  });

  test("an exchange chip lights only for the winner whose choice is open", () => {
    for (const [choiceOpen, viewerIsWinner] of [[false, true], [true, false], [false, false]]) {
      const shown = turnPresentation({ ...base, shownTurnIsMine: true, exchange: { chip: "CHIP", choiceOpen, viewerIsWinner, active: true } });
      assert.equal(shown.chip.lit, false);
    }
  });

  test("both timer questions", () => {
    for (const r of clockRows) {
      const shown = turnPresentation({
        ...base,
        roundOver: r.roundOver,
        exchange: { ...base.exchange, active: r.exchangeActive },
        timer: { seconds: 20, includeNewTrick: r.includeNewTrick, pausable: r.pausable },
        isMyTurn: r.isMyTurn,
        isFinished: r.isFinished,
        isNewTrick: r.isNewTrick,
        holdingForStart: r.holdingForStart,
      });
      assert.equal(`${shown.clock.active ? "c" : "-"}${shown.seat ? "s" : "-"}`, r.answer, JSON.stringify(r));
    }
  });

  test("with no timer, neither clock runs", () => {
    const shown = turnPresentation({ ...base, shownTurnIsMine: true, isMyTurn: true });
    assert.equal(shown.clock.active, false);
    assert.equal(shown.seat, undefined);
  });

  test("the chip's clock and the ring restart on the same key, and hold together", () => {
    const shown = turnPresentation({
      ...base,
      shownTurnIsMine: true,
      isMyTurn: true,
      held: true,
      timer: { seconds: 20, resetKey: "re", includeNewTrick: true },
    });
    assert.deepEqual(shown.seat, { seconds: 20, resetKey: "tok|re", held: true });
    assert.deepEqual([shown.window.resetKey, shown.window.running, shown.window.held], ["tok|re", true, true]);
    assert.equal(shown.clock.revealed, true);
  });

  test("a lead offline runs the window, which only an active chip's turn lets expire", () => {
    const onExpire = () => {};
    const lead = turnPresentation({ ...base, isMyTurn: true, isNewTrick: true, timer: { seconds: 20, onExpire } });
    assert.deepEqual([lead.clock.active, lead.window.running, lead.window.onExpire], [false, true, undefined]);
    const answer = turnPresentation({ ...base, isMyTurn: true, timer: { seconds: 20, onExpire } });
    assert.deepEqual([answer.clock.active, answer.window.running, answer.window.onExpire], [true, true, onExpire]);
  });

  test("the next-round vote takes the chip's countdown, which nothing holds and nothing expires", () => {
    const onExpire = () => {};
    const shown = turnPresentation({
      ...base,
      roundOver: true,
      held: true,
      timer: { seconds: 20, onExpire },
      vote: { seconds: 30, resetKey: "v1" },
    });
    assert.deepEqual(shown.clock, { active: true, revealed: true });
    assert.deepEqual(shown.window, { seconds: 30, resetKey: "vote|v1", running: true, held: false });
  });
});
