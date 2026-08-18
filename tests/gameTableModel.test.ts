// Pure logic behind the shared game table (components/GameTable.tsx), extracted
// into components/gameTableModel.ts so `node --test` can load it — the table
// itself is .tsx and cannot be type-stripped by Node's loader.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts for why the .ts extension is required
import { CARD_W } from "../components/handLayout.ts";
// @ts-ignore
import {
  CARD_H,
  BTN_W,
  BTN_H,
  SIDE_BTN_W,
  TOP_BAR_H,
  TABLE_M,
  SIDE_SECTION_W,
  TOP_SECTION_H,
  HAND_SECTION_H,
  getOpponentPosition,
  seatDirection,
  arrangeOpponents,
  handCountOf,
  comboKey,
  advancePile,
  roundClosedWithWinner,
  EMPTY_PILE,
  canPassNow,
  playButtonLabel,
  turnTimerActive,
  urgentThresholdSeconds,
  URGENT_TICK_SECONDS,
  notificationTopOffset,
  startCardBannerText,
  computeTableFrame,
  readExchange,
  INACTIVE_EXCHANGE,
  describeTableForA11y,
  impactDelayMs,
  FLIGHT_MS,
  LANDING_FRACTION,
  passedSeats,
  straightTopRankChar,
  type ComboShape,
  type TableA11yStrings,
} from "../components/gameTableModel.ts";
// @ts-ignore
import {
  buildCombination,
  processPass,
  processPlay,
  c,
  makePlayer,
  makeState,
  type GameState,
  type Player,
} from "./helpers.ts";

// ─── Layout constants ─────────────────────────────────────────────────────────

describe("layout constants (CLAUDE.md: MUST NOT CHANGE)", () => {
  test("every constant still holds the value both game screens are built around", () => {
    // These are pinned, not documented: a silent change to any of them breaks
    // the table on one screen or the other with no error signal.
    assert.equal(CARD_W, 58);
    assert.equal(CARD_H, 84);
    assert.equal(BTN_W, 84);
    assert.equal(BTN_H, 84);
    assert.equal(SIDE_BTN_W, 62);
    assert.equal(TOP_BAR_H, 40);
    assert.equal(TABLE_M, 4);
    assert.equal(SIDE_SECTION_W, 130);
    assert.equal(TOP_SECTION_H, 70);
  });

  test("HAND_SECTION_H keeps its CARD_H + 16 headroom for the selection lift", () => {
    // The -14px selection lift has to fit inside the section; the 16px of
    // slack is what gives it room without clipping.
    assert.equal(HAND_SECTION_H, CARD_H + 16);
    assert.ok(HAND_SECTION_H - CARD_H >= 14);
  });
});

// ─── Seating ──────────────────────────────────────────────────────────────────

describe("getOpponentPosition", () => {
  test("a lone opponent always sits opposite", () => {
    assert.equal(getOpponentPosition(1, 1), "top");
  });

  test("with two opponents the next seat is on the right, the other opposite", () => {
    assert.equal(getOpponentPosition(1, 2), "right");
    assert.equal(getOpponentPosition(2, 2), "top");
  });

  test("with three opponents the seats read clockwise: right, top, left", () => {
    assert.equal(getOpponentPosition(1, 3), "right");
    assert.equal(getOpponentPosition(2, 3), "top");
    assert.equal(getOpponentPosition(3, 3), "left");
  });
});

describe("seatDirection", () => {
  test("the viewer is always at the bottom, whatever their seat", () => {
    assert.equal(seatDirection(0, 0, 4), "bottom");
    assert.equal(seatDirection(3, 3, 4), "bottom");
    assert.equal(seatDirection(1, 1, 2), "bottom");
  });

  test("rotation wraps around the table", () => {
    // Viewer in seat 3 of 4: seat 0 is one step clockwise, so it is on the right.
    assert.equal(seatDirection(0, 3, 4), "right");
    assert.equal(seatDirection(1, 3, 4), "top");
    assert.equal(seatDirection(2, 3, 4), "left");
  });

  test("every non-viewer seat lands on exactly one distinct side", () => {
    for (let count = 2; count <= 4; count++) {
      for (let viewer = 0; viewer < count; viewer++) {
        const sides = [];
        for (let seat = 0; seat < count; seat++) {
          if (seat === viewer) continue;
          sides.push(seatDirection(seat, viewer, count));
        }
        assert.equal(sides.length, count - 1);
        assert.equal(new Set(sides).size, count - 1, `viewer ${viewer} of ${count}`);
        assert.ok(!sides.includes("bottom"));
      }
    }
  });

  test("a degenerate player count never throws", () => {
    assert.equal(seatDirection(0, 0, 0), "bottom");
  });
});

describe("arrangeOpponents", () => {
  const players = ["A", "B", "C", "D"];

  test("four players: the viewer is excluded and the other three are placed", () => {
    const seats = arrangeOpponents(players, 0);
    assert.deepEqual(seats.right, { player: "B", seat: 1 });
    assert.deepEqual(seats.top, { player: "C", seat: 2 });
    assert.deepEqual(seats.left, { player: "D", seat: 3 });
  });

  test("three players fill top and right only", () => {
    const seats = arrangeOpponents(["A", "B", "C"], 0);
    assert.deepEqual(seats.right, { player: "B", seat: 1 });
    assert.deepEqual(seats.top, { player: "C", seat: 2 });
    assert.equal(seats.left, null);
  });

  test("two players put the opponent opposite", () => {
    const seats = arrangeOpponents(["A", "B"], 1);
    assert.deepEqual(seats.top, { player: "A", seat: 0 });
    assert.equal(seats.left, null);
    assert.equal(seats.right, null);
  });

  test("the arrangement rotates with the viewer's seat", () => {
    const seats = arrangeOpponents(players, 2);
    assert.deepEqual(seats.right, { player: "D", seat: 3 });
    assert.deepEqual(seats.top, { player: "A", seat: 0 });
    assert.deepEqual(seats.left, { player: "B", seat: 1 });
  });

  test("no player is ever placed twice", () => {
    const seats = arrangeOpponents(players, 1);
    const placed = [seats.top, seats.left, seats.right]
      .filter((s) => s !== null)
      .map((s) => s!.seat);
    assert.equal(new Set(placed).size, placed.length);
    assert.ok(!placed.includes(1));
  });
});

describe("handCountOf", () => {
  test("offline: the hand itself is the count", () => {
    assert.equal(handCountOf({ hand: [{}, {}, {}] } as any), 3);
  });

  test("online: the server-supplied handCount wins over a blanked hand", () => {
    // This is the whole reason opponents' cards are hidden online — the hand
    // arrives empty and only the count is shipped.
    assert.equal(handCountOf({ hand: [], handCount: 11 } as any), 11);
  });

  test("a handCount of zero is honoured, not treated as missing", () => {
    assert.equal(handCountOf({ hand: [{}, {}], handCount: 0 } as any), 0);
  });
});

// ─── Pile state ───────────────────────────────────────────────────────────────

const combo = (ids: string[]): any => ({
  type: "single",
  strength: 1,
  cards: ids.map((id) => ({ id })),
});

describe("comboKey", () => {
  test("the same cards played by different seats are different plays", () => {
    assert.notEqual(comboKey(combo(["a", "b"]), 0), comboKey(combo(["a", "b"]), 1));
  });

  test("the same play produces a stable key", () => {
    assert.equal(comboKey(combo(["a", "b"]), 2), comboKey(combo(["a", "b"]), 2));
  });
});

describe("advancePile", () => {
  test("the first play sits alone on the table", () => {
    const first = combo(["a"]);
    const next = advancePile(EMPTY_PILE, first);
    assert.equal(next.current, first);
    assert.equal(next.prev, null);
  });

  test("the beaten combination fades to the previous layer exactly once", () => {
    const a = combo(["a"]);
    const b = combo(["b"]);
    const c = combo(["c"]);
    const s1 = advancePile(EMPTY_PILE, a);
    const s2 = advancePile(s1, b);
    assert.equal(s2.prev, a);
    assert.equal(s2.current, b);
    const s3 = advancePile(s2, c);
    // `a` is gone entirely — never rendered twice, never stuck behind.
    assert.equal(s3.prev, b);
    assert.equal(s3.current, c);
    assert.notEqual(s3.prev, a);
  });

  test("a card is never in both layers at once", () => {
    const a = combo(["a"]);
    const s = advancePile(advancePile(EMPTY_PILE, a), combo(["b"]));
    const prevIds = (s.prev?.cards ?? []).map((c: any) => c.id);
    const curIds = (s.current?.cards ?? []).map((c: any) => c.id);
    assert.deepEqual(prevIds.filter((id: string) => curIds.includes(id)), []);
  });

  test("the input state is not mutated", () => {
    const s1 = advancePile(EMPTY_PILE, combo(["a"]));
    const snapshot = { ...s1 };
    advancePile(s1, combo(["b"]));
    assert.deepEqual(s1, snapshot);
    assert.deepEqual(EMPTY_PILE, { prev: null, current: null });
  });
});

describe("roundClosedWithWinner", () => {
  test("the closing pass — the table is empty and a seat took it", () => {
    assert.equal(
      roundClosedWithWinner({ lastPlayedCombination: null, roundWinner: 2 }),
      true
    );
  });

  test("seat 0 counts, which a truthiness check would miss", () => {
    assert.equal(
      roundClosedWithWinner({ lastPlayedCombination: null, roundWinner: 0 }),
      true
    );
  });

  test("a round in progress has not closed, whoever won the last one", () => {
    assert.equal(
      roundClosedWithWinner({ lastPlayedCombination: combo(["a"]), roundWinner: 1 }),
      false
    );
  });

  test("a pass that does not close the round leaves nobody credited", () => {
    assert.equal(
      roundClosedWithWinner({ lastPlayedCombination: combo(["a"]), roundWinner: null }),
      false
    );
  });

  test("a freshly dealt hand is empty but nothing has been won", () => {
    assert.equal(
      roundClosedWithWinner({ lastPlayedCombination: null, roundWinner: null }),
      false
    );
    assert.equal(roundClosedWithWinner({ lastPlayedCombination: null }), false);
  });
});

// ─── Passed seats ─────────────────────────────────────────────────────────────

/** Four seats, all still holding cards. */
const ALL_IN = [false, false, false, false];

describe("passedSeats", () => {
  test("nobody has answered yet — the turn is with the seat right after the play", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 2,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      []
    );
  });

  test("one seat passed", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 1,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      [2]
    );
  });

  test("two seats passed, in the order they passed", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      [2, 1]
    );
  });

  test("the walk wraps past seat 0", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 2,
        lastPlayedBy: 1,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      [0, 3]
    );
  });

  test("a seat that has gone out is stepped over, not marked", () => {
    // Seat 2 emptied its hand in an earlier round, so the turn went 3 → 1.
    // Marking it would claim it answered a round it is not in.
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 1,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: [false, false, true, false],
      }),
      []
    );
  });

  test("a seat that has gone out does not stop the walk short", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 3,
        lastPlayedCombination: combo(["a"]),
        outOfCards: [false, false, true, false],
      }),
      [1]
    );
  });

  test("between rounds nothing is marked", () => {
    // `processPass` clears the combination on the pass that closes the round,
    // which is the moment every marker must go.
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 3,
        lastPlayedBy: 3,
        lastPlayedCombination: null,
        outOfCards: ALL_IN,
      }),
      []
    );
  });

  test("a freshly dealt hand, whose lastPlayedBy names no seat", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: -1,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      []
    );
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 9,
        lastPlayedCombination: combo(["a"]),
        outOfCards: ALL_IN,
      }),
      []
    );
  });

  test("heads-up: the only other seat is the one on move, so it has not passed", () => {
    assert.deepEqual(
      passedSeats({
        currentTurnIndex: 0,
        lastPlayedBy: 1,
        lastPlayedCombination: combo(["a"]),
        outOfCards: [false, false],
      }),
      []
    );
  });
});

describe("passedSeats walks the direction the engine deals turns", () => {
  // Against real transitions, not a hand-built state: `getNextActivePlayer`
  // moves to the *previous* seat index, and a marker on the wrong seat is
  // worse than no marker. Everything below comes out of the engine itself.
  const hands = (): Player[] => [
    makePlayer("player_0", [c("5", "spades"), c("6", "spades")]),
    makePlayer("player_1", [c("7", "hearts"), c("8", "hearts")]),
    makePlayer("player_2", [c("9", "clubs"), c("10", "clubs")]),
    makePlayer("player_3", [c("J", "diamonds"), c("Q", "diamonds")]),
  ];

  const view = (s: GameState) => ({
    currentTurnIndex: s.currentTurnIndex,
    lastPlayedBy: s.lastPlayedBy,
    lastPlayedCombination: s.lastPlayedCombination,
    outOfCards: s.players.map((p) => p.hand.length === 0),
  });

  test("each pass marks the seat that made it, and the round close clears them", () => {
    let s = makeState(hands(), {
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    assert.equal(s.currentTurnIndex, 2, "the engine deals the next turn downward");
    assert.deepEqual(passedSeats(view(s)), []);

    s = processPass(s);
    assert.equal(s.currentTurnIndex, 1);
    assert.deepEqual(passedSeats(view(s)), [2]);

    s = processPass(s);
    assert.equal(s.currentTurnIndex, 0);
    assert.deepEqual(passedSeats(view(s)), [2, 1]);

    s = processPass(s);
    assert.equal(s.lastPlayedCombination, null, "the third pass closes the round");
    assert.deepEqual(passedSeats(view(s)), []);
  });

  test("a seat that goes out mid-round is never marked", () => {
    // Seat 2 holds one card: it answers seat 3's lead by playing it and is out.
    const players = hands();
    players[2].hand = [c("9", "clubs")];
    let s = makeState(players, {
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    s = processPlay(s, buildCombination([c("9", "clubs")])!);
    assert.equal(s.players[2].hand.length, 0);
    assert.equal(s.lastPlayedBy, 2);

    s = processPass(s);
    assert.deepEqual(passedSeats(view(s)), [1]);

    s = processPass(s);
    const marked = passedSeats(view(s));
    assert.ok(!marked.includes(2), "seat 2 played, it did not pass");
    assert.deepEqual(marked, [1, 0]);
  });
});

// ─── Affordances ──────────────────────────────────────────────────────────────

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
});

// ─── Copy ─────────────────────────────────────────────────────────────────────

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

describe("notificationTopOffset", () => {
  // The table's top bar occupies [topPad, topPad + TOP_BAR_H) and carries the
  // turn billboard, the countdown and the hand count — the very things an AFK
  // or seat-takeover notice is explaining.
  const topPad = 47;

  test("in landscape the banner starts below the table's top bar", () => {
    const top = notificationTopOffset({ topPad, landscape: true });
    assert.ok(top >= topPad + TOP_BAR_H, `${top} still overlaps the top bar`);
    assert.equal(top, topPad + TOP_BAR_H + TABLE_M);
  });

  test("portrait — every menu screen — is left exactly where it was", () => {
    assert.equal(notificationTopOffset({ topPad, landscape: false }), topPad);
  });

  test("a zero inset still clears the bar in landscape", () => {
    assert.ok(notificationTopOffset({ topPad: 0, landscape: true }) >= TOP_BAR_H);
  });
});

describe("startCardBannerText", () => {
  test("second person when the viewer opens", () => {
    assert.equal(
      startCardBannerText({ card: { rank: "3" } as any, starterName: "Ana", viewerIsStarter: true }),
      "Inizi tu! Hai il 3♠"
    );
  });

  test("names the opener otherwise", () => {
    assert.equal(
      startCardBannerText({ card: { rank: "3" } as any, starterName: "Ana", viewerIsStarter: false }),
      "Ana inizia con il 3♠"
    );
  });
});

// ─── Frame ────────────────────────────────────────────────────────────────────

describe("computeTableFrame", () => {
  const insets = { top: 20, bottom: 10, left: 44, right: 44 };

  test("native: the felt is inset by TABLE_M inside the safe area, below the top bar", () => {
    const f = computeTableFrame({ width: 800, insets, isWeb: false });
    assert.equal(f.tableLeft, 44 + TABLE_M);
    assert.equal(f.tableTop, 20 + TOP_BAR_H + TABLE_M);
    assert.equal(f.tableRight, 44 + TABLE_M);
    assert.equal(f.tableBottom, 10 + TABLE_M);
  });

  test("web ignores insets and uses the fixed pads both screens used", () => {
    const f = computeTableFrame({ width: 800, insets, isWeb: true });
    assert.equal(f.topPad, 67);
    assert.equal(f.bottomPad, 34);
    assert.equal(f.leftPad, 0);
    assert.equal(f.rightPad, 0);
    assert.equal(f.tableLeft, TABLE_M);
  });

  test("handAvailW matches the pre-refactor formula on both screens", () => {
    // Offline computed it via an intermediate `tableW`; online inlined it.
    // Both reduce to this, and the two must not drift again.
    const f = computeTableFrame({ width: 800, insets, isWeb: false });
    const tableW = 800 - f.tableLeft - f.tableRight;
    assert.equal(f.handAvailW, tableW - (SIDE_BTN_W + 8) * 2 - 8);
  });

  test("the hand row leaves room for both side buttons", () => {
    const f = computeTableFrame({ width: 800, insets, isWeb: false });
    assert.ok(f.handAvailW > 0);
    assert.ok(f.handAvailW < 800 - SIDE_BTN_W * 2);
  });
});

// ─── Exchange ─────────────────────────────────────────────────────────────────

describe("readExchange", () => {
  const players = [{ name: "A" }, { name: "B" }, { name: "C" }] as any[];
  const withPhase = (phase: any) => ({ players, exchangePhase: phase }) as any;

  test("no phase at all is inactive", () => {
    assert.deepEqual(readExchange(withPhase(undefined), 0), INACTIVE_EXCHANGE);
  });

  test("an inactive phase object is still inactive", () => {
    assert.deepEqual(
      readExchange(withPhase({ active: false, winnerIdx: 0, loserIdx: 2 }), 0),
      INACTIVE_EXCHANGE
    );
  });

  test("the winner is asked to give, the loser to wait", () => {
    const state = withPhase({ active: true, winnerIdx: 0, loserIdx: 2 });
    const asWinner = readExchange(state, 0);
    assert.equal(asWinner.viewerIsWinner, true);
    assert.equal(asWinner.viewerIsLoser, false);
    assert.equal(asWinner.winner, players[0]);
    assert.equal(asWinner.loser, players[2]);

    const asLoser = readExchange(state, 2);
    assert.equal(asLoser.viewerIsWinner, false);
    assert.equal(asLoser.viewerIsLoser, true);
  });

  test("a bystander is neither", () => {
    const v = readExchange(withPhase({ active: true, winnerIdx: 0, loserIdx: 2 }), 1);
    assert.equal(v.active, true);
    assert.equal(v.viewerIsWinner, false);
    assert.equal(v.viewerIsLoser, false);
  });

  test("an out-of-range seat resolves to null rather than undefined", () => {
    const v = readExchange(withPhase({ active: true, winnerIdx: 9, loserIdx: 2 }), 9);
    assert.equal(v.winner, null);
  });
});

// ─── Screen-reader description ───────────────────────────────────────────────

// Stand-in for the strings GameTable.tsx would build via t()/tn() — every
// phrase carries a distinctive marker so assertions can pin exactly which
// sentence fired without depending on real copy.
const a11yStrings: TableA11yStrings = {
  yourTurn: "YOUR_TURN",
  turnOf: (name) => `TURN_OF(${name})`,
  emptyTable: "EMPTY_TABLE",
  youPlayed: (label) => `YOU_PLAYED(${label})`,
  playerPlayed: (name, label) => `PLAYED(${name},${label})`,
  opponentCardCount: (name, count) => `OPP(${name}=${count})`,
  yourCardCount: (count) => `YOU=${count}`,
  exchangeGiveCard: (loserName) => `EXCHANGE_GIVE(${loserName})`,
  exchangeWaitForCard: (winnerName) => `EXCHANGE_WAIT(${winnerName})`,
};

describe("describeTableForA11y", () => {
  test("the brief's example: viewer's turn, one opponent, matches both name and count", () => {
    const text = describeTableForA11y(
      {
        isMyTurn: true,
        currentTurnName: "",
        myCardCount: 7,
        lastPlay: { label: "coppia di 8", byViewer: false, byName: "Ana" },
        opponents: [{ name: "Ana", cardCount: 3 }],
      },
      a11yStrings
    );
    assert.match(text, /Ana/);
    assert.match(text, /3/);
  });

  test("whose turn leads the description, and it differs for the viewer vs someone else", () => {
    const base = {
      myCardCount: 5,
      lastPlay: null,
      opponents: [] as { name: string; cardCount: number }[],
    };
    const mine = describeTableForA11y({ ...base, isMyTurn: true, currentTurnName: "Ana" }, a11yStrings);
    assert.ok(mine.startsWith("YOUR_TURN"));

    const theirs = describeTableForA11y({ ...base, isMyTurn: false, currentTurnName: "Ana" }, a11yStrings);
    assert.ok(theirs.startsWith("TURN_OF(Ana)"));
  });

  test("an empty table (nobody has led the round yet) says so instead of naming a play", () => {
    const text = describeTableForA11y(
      { isMyTurn: true, currentTurnName: "", myCardCount: 10, lastPlay: null, opponents: [] },
      a11yStrings
    );
    assert.match(text, /EMPTY_TABLE/);
    assert.doesNotMatch(text, /PLAYED/);
  });

  test("the viewer's own last play reads differently from an opponent's", () => {
    const mine = describeTableForA11y(
      {
        isMyTurn: false,
        currentTurnName: "Ana",
        myCardCount: 6,
        lastPlay: { label: "tris di re", byViewer: true, byName: "" },
        opponents: [],
      },
      a11yStrings
    );
    assert.match(mine, /YOU_PLAYED\(tris di re\)/);

    const theirs = describeTableForA11y(
      {
        isMyTurn: false,
        currentTurnName: "Ana",
        myCardCount: 6,
        lastPlay: { label: "tris di re", byViewer: false, byName: "Ana" },
        opponents: [],
      },
      a11yStrings
    );
    assert.match(theirs, /PLAYED\(Ana,tris di re\)/);
  });

  test("multiple opponents with different counts are each named, in the order given", () => {
    const text = describeTableForA11y(
      {
        isMyTurn: true,
        currentTurnName: "",
        myCardCount: 9,
        lastPlay: null,
        opponents: [
          { name: "Ana", cardCount: 12 },
          { name: "Bes", cardCount: 1 },
          { name: "Cel", cardCount: 7 },
        ],
      },
      a11yStrings
    );
    assert.match(text, /OPP\(Ana=12\)/);
    assert.match(text, /OPP\(Bes=1\)/);
    assert.match(text, /OPP\(Cel=7\)/);
    // Order: Ana before Bes before Cel.
    assert.ok(text.indexOf("Ana=12") < text.indexOf("Bes=1"));
    assert.ok(text.indexOf("Bes=1") < text.indexOf("Cel=7"));
  });

  test("opponent counts and the viewer's own count both appear, own count last", () => {
    const text = describeTableForA11y(
      {
        isMyTurn: true,
        currentTurnName: "",
        myCardCount: 4,
        lastPlay: null,
        opponents: [{ name: "Ana", cardCount: 2 }],
      },
      a11yStrings
    );
    assert.ok(text.indexOf("OPP(Ana=2)") < text.indexOf("YOU=4"));
    assert.ok(text.endsWith("YOU=4"));
  });

  test("exchange phase: the viewer who won is told to give, not asked whose turn it is", () => {
    const text = describeTableForA11y(
      {
        isMyTurn: false,
        currentTurnName: "Ana",
        myCardCount: 13,
        lastPlay: null,
        opponents: [],
        exchange: {
          active: true,
          viewerIsWinner: true,
          viewerIsLoser: false,
          winnerName: "",
          loserName: "Dea",
        },
      },
      a11yStrings
    );
    assert.match(text, /^EXCHANGE_GIVE\(Dea\)/);
    assert.doesNotMatch(text, /YOUR_TURN|TURN_OF/);
  });

  test("exchange phase: the viewer who lost is told they are waiting", () => {
    const text = describeTableForA11y(
      {
        isMyTurn: false,
        currentTurnName: "Ana",
        myCardCount: 14,
        lastPlay: null,
        opponents: [],
        exchange: {
          active: true,
          viewerIsWinner: false,
          viewerIsLoser: true,
          winnerName: "Ana",
          loserName: "",
        },
      },
      a11yStrings
    );
    assert.match(text, /^EXCHANGE_WAIT\(Ana\)/);
  });

  test("exchange phase: a bystander gets the ordinary turn sentence, not an exchange one", () => {
    const text = describeTableForA11y(
      {
        isMyTurn: false,
        currentTurnName: "Ana",
        myCardCount: 8,
        lastPlay: null,
        opponents: [],
        exchange: {
          active: true,
          viewerIsWinner: false,
          viewerIsLoser: false,
          winnerName: "Ana",
          loserName: "Dea",
        },
      },
      a11yStrings
    );
    assert.match(text, /^TURN_OF\(Ana\)/);
    assert.doesNotMatch(text, /EXCHANGE/);
  });
});

describe("straightTopRankChar", () => {
  test("plain numeric ranks pass straight through", () => {
    assert.equal(straightTopRankChar(5), "5");
    assert.equal(straightTopRankChar(10), "10");
  });

  test("an ace-low straight (docs/RULES.md §6, e.g. A-2-3-4-5) tops out at 5, not 2 or A", () => {
    // getStraightStrength returns 5 for A-2-3-4-5 — this only has to render it.
    assert.equal(straightTopRankChar(5), "5");
  });

  test("face values above 10 render as letters", () => {
    assert.equal(straightTopRankChar(11), "J");
    assert.equal(straightTopRankChar(12), "Q");
    assert.equal(straightTopRankChar(13), "K");
  });

  test("an ace-high straight (e.g. 10-J-Q-K-A) tops out at A, via either face value", () => {
    assert.equal(straightTopRankChar(14), "A");
    assert.equal(straightTopRankChar(1), "A");
  });
});

// ─── Impact timing ────────────────────────────────────────────────────────────

describe("impact feedback is timed to the card landing, not to the throw", () => {
  test("a played card takes 312ms to reach the pile", () => {
    // Sound, haptics and the bomb shake are scheduled against this. When they
    // fired at throw time instead, the bang arrived a third of a second before
    // the card that caused it.
    assert.equal(FLIGHT_MS, 380);
    assert.equal(LANDING_FRACTION, 0.82);
    assert.equal(impactDelayMs(false), 312);
  });

  test("under reduced motion there is no flight to wait for", () => {
    // FlyingCards skips the animation entirely, so a delay here would be a
    // gap of silence rather than anticipation.
    assert.equal(impactDelayMs(true), 0);
  });

  test("the delay is a whole number of milliseconds", () => {
    // setTimeout truncates, and a fractional delay would drift against the
    // animation it is supposed to match.
    assert.equal(impactDelayMs(false) % 1, 0);
  });
});
