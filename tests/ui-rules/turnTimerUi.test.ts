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
import { TURN_POLICY, turnAction } from "../../lib/game/turnSchedule.ts";
import { scanSources, sourcesUnder } from "../helpers/sourceScan.ts";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");


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
    roundOver: false,
    exchangeHolds: false,
  };

  test("runs while answering a combination on your turn", () => {
    assert.equal(turnTimerActive(base), true);
  });

  test("never during the exchange, after the game, or when it is not your turn", () => {
    assert.equal(turnTimerActive({ ...base, exchangeHolds: true }), false);
    assert.equal(turnTimerActive({ ...base, roundOver: true }), false);
    assert.equal(turnTimerActive({ ...base, isMyTurn: false }), false);
    assert.equal(turnTimerActive({ ...base, isFinished: true }), false);
  });

  test("a lifted announcement hold never overrides the harder stops", () => {
    assert.equal(turnTimerActive({ ...base, exchangeHolds: true, announcementHolds: false }), false);
  });

  test("an announcement holding the table stops a clock this client owns", () => {
    // The floor: without the hold the same case runs, so this is about the
    // hold and not about some other stop already covering it.
    assert.equal(turnTimerActive(base), true);
    assert.equal(
      turnTimerActive({ ...base, announcementHolds: true }),
      false
    );
  });

  test("…and the caller says so, because a pause a server is not keeping is a lie", () => {
    // Online the deadline is the server's: `turnPresentation` holds only an
    // offline table, so the hold never reaches here and the clock keeps running.
    assert.equal(
      turnTimerActive({ ...base, announcementHolds: false }),
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
 * Bits: isMyTurn, isFinished, isNewTrick, roundOver, exchangeOpen, online, holdingForStart.
 * Offline owns its deadline and pauses it for an announcement; online never does (the server's AFK window runs on).
 */
const CLOCK_TABLE: string[] = [
  "0000000:-s 0000001:-- 0000010:-s 0000011:-s 0000100:-- 0000101:-- 0000110:-s 0000111:-s",
  "0001000:-- 0001001:-- 0001010:-- 0001011:-- 0001100:-- 0001101:-- 0001110:-- 0001111:--",
  "0010000:-s 0010001:-- 0010010:-s 0010011:-s 0010100:-- 0010101:-- 0010110:-s 0010111:-s",
  "0011000:-- 0011001:-- 0011010:-- 0011011:-- 0011100:-- 0011101:-- 0011110:-- 0011111:--",
  "0100000:-s 0100001:-- 0100010:-s 0100011:-s 0100100:-- 0100101:-- 0100110:-s 0100111:-s",
  "0101000:-- 0101001:-- 0101010:-- 0101011:-- 0101100:-- 0101101:-- 0101110:-- 0101111:--",
  "0110000:-s 0110001:-- 0110010:-s 0110011:-s 0110100:-- 0110101:-- 0110110:-s 0110111:-s",
  "0111000:-- 0111001:-- 0111010:-- 0111011:-- 0111100:-- 0111101:-- 0111110:-- 0111111:--",
  "1000000:cs 1000001:-- 1000010:cs 1000011:cs 1000100:-- 1000101:-- 1000110:cs 1000111:cs",
  "1001000:-- 1001001:-- 1001010:-- 1001011:-- 1001100:-- 1001101:-- 1001110:-- 1001111:--",
  "1010000:-s 1010001:-- 1010010:cs 1010011:cs 1010100:-- 1010101:-- 1010110:cs 1010111:cs",
  "1011000:-- 1011001:-- 1011010:-- 1011011:-- 1011100:-- 1011101:-- 1011110:-- 1011111:--",
  "1100000:-s 1100001:-- 1100010:-s 1100011:-s 1100100:-- 1100101:-- 1100110:-s 1100111:-s",
  "1101000:-- 1101001:-- 1101010:-- 1101011:-- 1101100:-- 1101101:-- 1101110:-- 1101111:--",
  "1110000:-s 1110001:-- 1110010:-s 1110011:-s 1110100:-- 1110101:-- 1110110:-s 1110111:-s",
  "1111000:-- 1111001:-- 1111010:-- 1111011:-- 1111100:-- 1111101:-- 1111110:-- 1111111:--",
];
const clockRows = CLOCK_TABLE.flatMap((line) => line.split(" ")).map((cell) => {
  const [bits, answer] = cell.split(":");
  const [isMyTurn, isFinished, isNewTrick, roundOver, exchangeOpen, online, holdingForStart] = [...bits].map(
    (b) => b === "1"
  );
  return { isMyTurn, isFinished, isNewTrick, roundOver, exchangeOpen, online, holdingForStart, answer };
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
    assert.equal(clockRows.length, 128);
    assert.equal(new Set(clockRows.map((r) => JSON.stringify(r))).size, 128);
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
            ? { open: true, viewerIsWinner: true, viewerIsLoser: false, winnerName: "W", loserName: "L" }
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
    exchange: { chip: null, choiceOpen: false, viewerIsWinner: false, open: false },
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
        exchange: exchange ? { chip: "CHIP", choiceOpen: true, viewerIsWinner: true, open: true } : base.exchange,
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
      const shown = turnPresentation({ ...base, shownTurnIsMine: true, exchange: { chip: "CHIP", choiceOpen, viewerIsWinner, open: true } });
      assert.equal(shown.chip.lit, false);
    }
  });

  test("both timer questions", () => {
    for (const r of clockRows) {
      const shown = turnPresentation({
        ...base,
        roundOver: r.roundOver,
        exchange: { ...base.exchange, open: r.exchangeOpen },
        timer: { seconds: 20, table: r.online ? "online" : "offline" },
        isMyTurn: r.isMyTurn,
        isFinished: r.isFinished,
        isNewTrick: r.isNewTrick,
        holdingForStart: r.holdingForStart,
      });
      assert.equal(`${shown.clock.active ? "c" : "-"}${shown.seatClock ? "s" : "-"}`, r.answer, JSON.stringify(r));
    }
  });

  test("with no timer, neither clock runs", () => {
    const shown = turnPresentation({ ...base, shownTurnIsMine: true, isMyTurn: true });
    assert.equal(shown.clock.active, false);
    assert.equal(shown.seatClock, false);
  });

  test("the chip's clock and the ring restart on the same key, and hold together", () => {
    const shown = turnPresentation({
      ...base,
      shownTurnIsMine: true,
      isMyTurn: true,
      held: true,
      timer: { seconds: 20, resetKey: "re", table: "online" },
    });
    assert.equal(shown.seatClock, true);
    assert.deepEqual([shown.window.resetKey, shown.window.running, shown.window.held], ["tok|re", true, true]);
    assert.equal(shown.clock.revealed, true);
  });

  test("a lead offline runs the window, which only an active chip's turn lets expire", () => {
    const onExpire = () => {};
    const lead = turnPresentation({ ...base, isMyTurn: true, isNewTrick: true, timer: { seconds: 20, table: "offline", onExpire } });
    assert.deepEqual([lead.clock.active, lead.window.running, lead.window.onExpire], [false, true, undefined]);
    const answer = turnPresentation({ ...base, isMyTurn: true, timer: { seconds: 20, table: "offline", onExpire } });
    assert.deepEqual([answer.clock.active, answer.window.running, answer.window.onExpire], [true, true, onExpire]);
  });

  test("the next-round vote takes the chip's countdown, which nothing holds and nothing expires", () => {
    const onExpire = () => {};
    const shown = turnPresentation({
      ...base,
      roundOver: true,
      held: true,
      timer: { seconds: 20, table: "offline", onExpire },
      vote: { seconds: 30, resetKey: "v1" },
    });
    assert.deepEqual(shown.clock, { active: true, revealed: true });
    assert.deepEqual(shown.window, { seconds: 30, resetKey: "vote|v1", running: true, held: false });
  });

  test("the chip's clock on a lead and on an answer is the table's TURN_POLICY", () => {
    for (const table of ["online", "offline"] as const) {
      for (const [isNewTrick, action] of [[true, "lead"], [false, "follow"]] as const) {
        const shown = turnPresentation({ ...base, shownTurnIsMine: true, isMyTurn: true, isNewTrick, timer: { seconds: 20, table } });
        assert.equal(shown.clock.active, TURN_POLICY[table][action].timed, `${table} ${action}`);
      }
    }
  });

  test("the give row is the policy's too: offline it has no deadline, online it has one the chip counts down", () => {
    for (const table of ["online", "offline"] as const) {
      const shown = turnPresentation({ ...base, shownTurnIsMine: true, isMyTurn: true, isNewTrick: true, exchange: { ...base.exchange, open: true }, timer: { seconds: 20, table } });
      assert.equal(shown.clock.active, TURN_POLICY[table].give.timed, `${table} give`);
      assert.equal(turnAction({ exchangeOpen: true, leading: true }), "give");
    }
    assert.equal(turnAction({ exchangeOpen: false, leading: true }), "lead");
    assert.equal(turnAction({ exchangeOpen: false, leading: false }), "follow");
  });

  test("no table states its own lead clock: each names its table and the policy answers", () => {
    const callers = sourcesUnder(root, ["app", "context"]).filter(([, text]) => /turnTimer/.test(text));
    assert.ok(callers.length >= 2, `found only ${callers.map(([f]) => f).join(", ")}`);
    assert.deepEqual(scanSources(/includeNewTrick\s*:/g, callers), []);
  });
});
