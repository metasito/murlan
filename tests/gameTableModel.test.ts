// Pure logic behind the shared game table (components/GameTable.tsx), extracted
// into components/gameTableModel.ts so `node --test` can load it — the table
// itself is .tsx and cannot be type-stripped by Node's loader.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CARD_H, CARD_W, BACK_SCALE } from "../components/cardFaceModel.ts";
import { Hold, TOUCH_TARGET_MIN, Trauma, Motion } from "../lib/tokens.ts";
import { blankComments } from "./helpers/sourceScan.ts";
import type { Card, Combination } from "../lib/gameEngine.ts";
import {
  ROTATE_SETTLED,
  ROTATE_UPRIGHT,
  rotateGlyphAngle,
  arrivingCard,
  readHandArrival,
  readThrownPlay,
  actionBtnSize,
  HAND_ZONE_GAP,
  CHIP_H,
  SIDE_SECTION_W,
  HAND_CROP,
  HAND_WIDTH_SHARE,
  HAND_ZONE_H,
  handVisibleH,
  handRowHeadroom,
  cardTilt,
  getOpponentPosition,
  seatDirection,
  arrangeOpponents,
  handCountOf,
  displayedHandCount,
  fanCounts,
  flightOrigin,
  exchangeFlight,
  sideSlotHeight,
  seatFanArc,
  SEAT_DISC,
  seatGap,
  seatLabelH,
  FAN_DRAWN_CARDS,
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
  computeTableFrame,
  railWidth,
  cutoutClass,
  railSideForOrientation,
  railSideFor,
  LANDSCAPE_LEFT,
  readExchange,
  viewerOwnsSeat,
  INACTIVE_EXCHANGE,
  describeTableForA11y,
  impactDelayMs,
  landingHoldMs,
  landSquashScale,
  LAND_SQUASH,
  settleForMotion,
  comboImpactTier,
  landingTier,
  traumaFor,
  shakeMagnitude,
  shakeOffset,
  FLIGHT_MS,
  LANDING_FRACTION,
  passedSeats,
  straightTopRankChar,
  sparkOffset,
  SPARK_COUNT,
  type ComboShape,
  type ImpactTier,
  type TableA11yStrings,
} from "../components/gameTableModel.ts";
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

// A representative resolved card height at scale 1, for tests that need a
// concrete number rather than the function CARD_H now is.
const CH = CARD_H(1);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function clientSources(): [string, string][] {
  return ["app", "components", "lib"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f): [string, string] => [
        path.posix.join(dir, f.split(path.sep).join("/")),
        readFileSync(path.join(repoRoot, dir, f), "utf8"),
      ])
  );
}

function scanSources(pattern: RegExp, sources: [string, string][]): string[] {
  const hits: string[] = [];
  for (const [file, src] of sources) {
    for (const m of src.matchAll(pattern)) hits.push(`${file}: ${m[0]}`);
  }
  return hits.sort();
}

function scan(pattern: RegExp): string[] {
  return scanSources(pattern, clientSources());
}

// Declarations, not uses: `width: CARD_W` and `CARD_W_SMALL` do not match.
const CARD_DIMENSION_DECL = /(?<![\w$])(?:const|let|var)\s+(?:CARD_W|CARD_H)(?![\w$])/g;
// A fan's spread, written out instead of asked for: an `overlap`/`maxAngle`/
// `maxTilt` binding, or the step ternary itself. The ternary is matched on any
// operand name — spelling `cards.length` as `count` is the same copy, and was
// enough to walk past a pattern that only knew the first spelling.
const FAN_CONSTANT_DECL =
  /(?<![\w$])(?:const|let|var)\s+(?:overlap|maxAngle|maxTilt)(?![\w$])|[\w.]+\s*>\s*\d+\s*\?\s*\d+\s*:/g;
// An arc's budget — the radius, ideal step and rise it is solved against.
const ARC_BUDGET_DECL = /(?<![\w$])(?:const|let|var)\s+\w+\s*:\s*ArcBudget(?![\w$])/g;

/** The one file allowed to hold an arc's own shape. */
const ARC_SOURCE = "components/tableArc.ts";

describe("layout constants (CLAUDE.md: MUST NOT CHANGE)", () => {
  test("every constant still holds the value both game screens are built around", () => {
    // These are pinned, not documented: a silent change to any of them breaks
    // the table on one screen or the other with no error signal.
    assert.equal(CARD_W(1), 64);
    assert.equal(CARD_H(1), 90);
    assert.equal(actionBtnSize(1), 56);
    assert.equal(HAND_ZONE_GAP, 26);
    assert.equal(CHIP_H(1), 23);
    assert.equal(SIDE_SECTION_W, 96);
  });

  test("CARD_W/CARD_H scale linearly with the short edge, no breakpoints", () => {
    assert.equal(CARD_W(0.5), CARD_W(1) * 0.5);
    assert.equal(CARD_H(2), CARD_H(1) * 2);
  });

  test("the hand zone keeps headroom for the selection lift, at any card height", () => {
    // The selection lift has to fit inside the zone above the cards, and it is
    // the *same* number: both are `handRowHeadroom` of the card being lifted,
    // so no card size can leave the lift a pixel more than the row reserves.
    for (const h of [CH * 0.7, CH, CH * 1.2]) {
      assert.equal(HAND_ZONE_H(h, 0), handVisibleH(h) + handRowHeadroom(h));
      assert.ok(HAND_ZONE_H(h, 0) - handVisibleH(h) >= handRowHeadroom(h));
    }
  });

  test("the headroom is a share of the card, so a tablet's lift is a tablet's", () => {
    assert.equal(handRowHeadroom(CH * 2), handRowHeadroom(CH) * 2);
    assert.equal(handRowHeadroom(CARD_H(1)), 16);
  });

  test("the hand zone carries the bottom safe pad itself — it runs to the device edge", () => {
    // PASSA and GIOCA sit on the safe line inside it and are never cropped;
    // only the cards run past it.
    assert.equal(HAND_ZONE_H(CH, 21) - HAND_ZONE_H(CH, 0), 21);
  });

  test("only the redundant upside-down index is cropped, never the rank corner", () => {
    // The rank a player reads is at the card's top-left, so a quarter off the
    // foot costs nothing. Half of it would start eating the pip field.
    assert.ok(HAND_CROP > 0 && HAND_CROP <= 0.3);
    assert.equal(handVisibleH(CH), CH * (1 - HAND_CROP));
  });

  // A copy of a constant also holds the pinned value, so the assertions above
  // can never see one. Only the source scan can.
  test("CARD_W and CARD_H are declared in components/cardFaceModel.ts and nowhere else", () => {
    assert.deepEqual(scan(CARD_DIMENSION_DECL), [
      "components/cardFaceModel.ts: const CARD_H",
      "components/cardFaceModel.ts: const CARD_W",
    ]);
  });

  test("nothing writes a fan's spread out any more; every arc asks for a budget", () => {
    assert.deepEqual(scan(FAN_CONSTANT_DECL), []);
  });

  test("only tableArc.ts declares an arc's budget, and it declares exactly three", () => {
    // The hand, the field and a seat's backs. A fourth would be a fourth arc
    // nobody asked for; one declared anywhere else is a copy that goes stale.
    assert.deepEqual(scan(ARC_BUDGET_DECL), [
      `${ARC_SOURCE}: const FIELD_ARC: ArcBudget`,
      `${ARC_SOURCE}: const HAND_ARC: ArcBudget`,
      `${ARC_SOURCE}: const SEAT_ARC: ArcBudget`,
    ]);
  });

  test("the budget scan fires on a budget declared anywhere else", () => {
    // The floor for the two scans above: both now expect a list this file's
    // own sources cannot grow, so a pattern that quietly stopped matching
    // would pass them both.
    const planted: [string, string][] = [
      ["components/table/example.tsx", "const MY_ARC: ArcBudget = { radius: 1, stepRatio: 1, rise: 1 };"],
    ];
    assert.deepEqual(scanSources(ARC_BUDGET_DECL, planted), [
      "components/table/example.tsx: const MY_ARC: ArcBudget",
    ]);
  });

  test("the fan scan fires on every shape a written-out spread takes", () => {
    const planted: [string, string][] = [
      [
        "components/table/example.tsx",
        [
          "const overlap = cards.length > 8 ? 9 : cards.length > 5 ? 12 : 14;",
          "const step = n > 8 ? 9 : n > 5 ? 12 : 14;",
          "const maxAngle = 22;",
          "const { step, angle, totalW } = fanOffsets(n, 'combo');",
        ].join("\n"),
      ],
    ];
    assert.deepEqual(scanSources(FAN_CONSTANT_DECL, planted), [
      "components/table/example.tsx: cards.length > 5 ? 12 :",
      "components/table/example.tsx: cards.length > 8 ? 9 :",
      "components/table/example.tsx: const maxAngle",
      "components/table/example.tsx: const overlap",
      "components/table/example.tsx: n > 5 ? 12 :",
      "components/table/example.tsx: n > 8 ? 9 :",
    ]);
  });

});

// ─── Card jitter ──────────────────────────────────────────────────────────────

describe("cardTilt", () => {
  test("the same card always tilts the same way, on every client and every frame", () => {
    assert.equal(cardTilt("7H", 4.5), cardTilt("7H", 4.5));
    assert.notEqual(cardTilt("7H", 4.5), cardTilt("8H", 4.5));
  });

  test("no card tilts past the bound it was given", () => {
    for (const id of ["3S", "QD", "joker-1", "10C", "AH"]) {
      assert.ok(Math.abs(cardTilt(id, 4.5)) <= 4.5);
      assert.ok(Math.abs(cardTilt(id, 0)) === 0);
    }
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

describe("displayedHandCount", () => {
  test("no flight: the display is exactly the authoritative count", () => {
    assert.equal(displayedHandCount(14, 0), 14);
  });

  test("mid-flight: the cards in the air are added back, reproducing the pre-play count", () => {
    // The engine already dropped the seat to 11 for a 3-card play; the fan
    // and the badge should still read the 14 the player saw before throwing.
    assert.equal(displayedHandCount(11, 3), 14);
  });

  test("once the flight lands, cardsInFlight is 0 and the sum already is handCount", () => {
    // No step-down to schedule: the same seat that read 14 during the flight
    // reads 11 the instant cardsInFlight returns to 0, with nothing else changing.
    assert.equal(displayedHandCount(11, 0), 11);
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
    const next = advancePile(EMPTY_PILE, first, 0);
    assert.equal(next.current, first);
    assert.equal(next.prev, null);
  });

  test("the beaten combination fades to the previous layer exactly once", () => {
    const a = combo(["a"]);
    const b = combo(["b"]);
    const c = combo(["c"]);
    const s1 = advancePile(EMPTY_PILE, a, 0);
    const s2 = advancePile(s1, b, 1);
    assert.equal(s2.prev, a);
    assert.equal(s2.current, b);
    const s3 = advancePile(s2, c, 2);
    // `a` is gone entirely — never rendered twice, never stuck behind.
    assert.equal(s3.prev, b);
    assert.equal(s3.current, c);
    assert.notEqual(s3.prev, a);
  });

  test("a card is never in both layers at once", () => {
    const a = combo(["a"]);
    const s = advancePile(advancePile(EMPTY_PILE, a, 0), combo(["b"]), 1);
    const prevIds = (s.prev?.cards ?? []).map((c: any) => c.id);
    const curIds = (s.current?.cards ?? []).map((c: any) => c.id);
    assert.deepEqual(prevIds.filter((id: string) => curIds.includes(id)), []);
  });

  test("the input state is not mutated", () => {
    const s1 = advancePile(EMPTY_PILE, combo(["a"]), 0);
    const snapshot = { ...s1 };
    advancePile(s1, combo(["b"]), 1);
    assert.deepEqual(s1, snapshot);
    assert.deepEqual(EMPTY_PILE, { prev: null, current: null, playedBy: null });
  });

  test("current's seat is carried alongside it, so the name and the shape can never name different plays", () => {
    const s1 = advancePile(EMPTY_PILE, combo(["a"]), 2);
    assert.equal(s1.playedBy, 2);
    const s2 = advancePile(s1, combo(["b"]), 0);
    // The new play's seat replaces the old one — `prev`'s owner is never
    // asked for, since only `current` is ever named.
    assert.equal(s2.playedBy, 0);
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
    // A king, because the answer has to actually beat the jack led below.
    const players = hands();
    players[2].hand = [c("K", "clubs")];
    let s = makeState(players, {
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    s = processPlay(s, buildCombination([c("K", "clubs")])!);
    assert.equal(s.players[2].hand.length, 0);
    assert.equal(s.lastPlayedBy, 2);

    s = processPass(s);
    assert.deepEqual(passedSeats(view(s)), [1]);

    s = processPass(s);
    const marked = passedSeats(view(s));
    assert.ok(!marked.includes(2), "seat 2 played, it did not pass");
    assert.deepEqual(marked, [1, 0]);
  });

  test("the hand ending on a play marks nobody", () => {
    // `processPlay` returns as soon as the hand is decided, so the turn never
    // moves off the seat that went out: `currentTurnIndex === lastPlayedBy`
    // with a combination still on the table. Seat 2 has simply not been dealt
    // another turn — it did not pass.
    const players = hands();
    players[0].hand = [];
    players[0].finishPosition = 1;
    players[1].hand = [];
    players[1].finishPosition = 2;
    players[3].hand = [c("J", "diamonds")];
    let s = makeState(players, {
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
      rankings: ["player_0", "player_1"],
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    assert.equal(s.gameOver, true);
    assert.equal(s.currentTurnIndex, s.lastPlayedBy);
    assert.notEqual(s.lastPlayedCombination, null);
    assert.deepEqual(passedSeats(view(s)), []);
  });

  test("teams: the losing pair is not marked when the hand ends", () => {
    // Seat 3 goes out with its partner already home, which decides the hand
    // (RULES.md §11) while both opponents still hold cards.
    const players = hands();
    players[0].team = "A";
    players[1].team = "B";
    players[2].team = "A";
    players[3].team = "B";
    players[1].hand = [];
    players[1].finishPosition = 1;
    players[3].hand = [c("J", "diamonds")];
    let s = makeState(players, {
      currentTurnIndex: 3,
      lastPlayedBy: 3,
      firstPlayMade: true,
      gameMode: "teams",
      rankings: ["player_1"],
    });

    s = processPlay(s, buildCombination([c("J", "diamonds")])!);
    assert.equal(s.gameOver, true);
    assert.ok(s.players[0].hand.length > 0 && s.players[2].hand.length > 0);
    assert.deepEqual(passedSeats(view(s)), []);
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
  // The HUD chips sit at the head of the felt and carry whose turn it is, the
  // countdown and the hand count — the very things an AFK or seat-takeover
  // notice is explaining, so the banner starts below them.
  const topPad = 47;

  test("in landscape the banner starts below the HUD chips", () => {
    const top = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 0 });
    assert.ok(top >= topPad + CHIP_H(1), `${top} still overlaps the chips`);
  });

  test("portrait — every menu screen — is left exactly where it was", () => {
    assert.equal(notificationTopOffset({ topPad, landscape: false, scale: 1, surplus: 0 }), topPad);
  });

  test("a zero inset still clears the chips in landscape", () => {
    assert.ok(notificationTopOffset({ topPad: 0, landscape: true, scale: 1, surplus: 0 }) >= CHIP_H(1));
  });

  // The chips this clears are inside the table's frame, and on a window past
  // the scale cap that frame starts `surplus` lower than the safe pad does.
  test("a surplus moves the chips down, and the banner with them", () => {
    const flush = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 0 });
    const inset = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 62 });
    assert.equal(inset - flush, 62);
  });

  test("scales with the table, so a tablet's banner clears a tablet's chips", () => {
    const one = notificationTopOffset({ topPad, landscape: true, scale: 1, surplus: 0 });
    const two = notificationTopOffset({ topPad, landscape: true, scale: 2, surplus: 0 });
    assert.ok(two > one, `${two} is no lower than ${one}`);
    assert.ok(two >= topPad + CHIP_H(2), `${two} still overlaps a tablet's chips`);
  });
});

// ─── Frame ────────────────────────────────────────────────────────────────────

describe("railWidth", () => {
  test("holds a 44pt knob with air on both sides when there is no cutout at all", () => {
    assert.ok(railWidth(0, 1) >= TOUCH_TARGET_MIN + 12);
  });

  test("a cutout narrower than the floor moves nothing", () => {
    // An iPhone X..14's 44pt landscape inset still fits under the floor, so a
    // notched phone and a notchless one lay out identically.
    assert.equal(railWidth(44, 1), railWidth(0, 1));
  });

  test("a Dynamic Island's inset widens the rail past its floor, plus clearance", () => {
    assert.equal(railWidth(59, 1), 59 + 12);
    assert.ok(railWidth(59, 1) > railWidth(0, 1));
  });

  test("grows with the table's scale, so it is never a fixed column on a tablet", () => {
    assert.ok(railWidth(0, 2) > railWidth(0, 1));
  });
});

describe("the rail's vertical pad", () => {
  // railWidth already floors the horizontal axis against a raw inset; the
  // knobs at the rail's own top and bottom need the same floor every other
  // element pinned to an edge gets (tableTop/tableBottom), or a device with
  // insets.top === 0 (an iPhone in landscape) flushes a knob against the
  // screen edge.
  test("the control rail and its settings sheet take the floored pad, not the raw inset", () => {
    assert.deepEqual(scan(/(?:top|bottom)Pad=\{frame\.(?:topPad|bottomPad)\}/g), []);
  });

  // Banning the raw spelling is half the pin: it also passes when the props are
  // gone entirely, or spelled some third way. Both ends of both must be found.
  test("both ends of both are pinned to the floored pad", () => {
    assert.equal(scan(/topPad=\{frame\.tableTop\}/g).length, 2);
    assert.equal(scan(/bottomPad=\{frame\.tableBottom\}/g).length, 2);
  });
});

describe("computeTableFrame", () => {
  const insets = { top: 20, bottom: 10, left: 44, right: 44 };
  const frameOf = (over: Partial<{ width: number; insets: typeof insets; scale: number }> = {}) =>
    computeTableFrame({ width: 800, height: 390, insets, scale: 1, ...over });

  // The felt itself is edge to edge; the frame is where things are *drawn* on
  // it. Each edge is the safe-area inset or the table's own padding, whichever
  // is further in — a device with no cutout still keeps the chrome off the rim.
  test("each edge clears both the safe area and the table's own padding", () => {
    const f = frameOf();
    assert.equal(f.tableTop, 20);
    assert.equal(f.tableRight, 44);
    assert.equal(f.tableBottom, 13);
    assert.ok(f.pad > 0, "nothing separates the chrome from the table's edge");
  });

  test("a screen with no insets at all still keeps the chrome off the rim", () => {
    const f = frameOf({ insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    assert.ok(f.tableTop > 0, "the chrome starts at the very top of the screen");
    assert.ok(f.tableRight > 0, "the chrome runs to the very right of the screen");
    assert.ok(f.tableBottom > 0, "the hand sits on the bottom edge of the screen");
  });

  test("the play area starts at the rail's outer edge, not at the safe-area inset", () => {
    const f = frameOf();
    assert.equal(f.rail, railWidth(insets.left, 1));
    assert.equal(f.tableLeft, f.rail);
  });

  test("the play area's centre is the box's own centre, so flex centring is honest", () => {
    // (rail + width - safeRight) / 2 — centring on 50% of the screen would put
    // the pile and the top seat ~17px off on an 844pt phone.
    const f = frameOf({ width: 844 });
    const boxCentre = f.tableLeft + (844 - f.tableLeft - f.tableRight) / 2;
    assert.equal(boxCentre, (f.rail + 844 - f.tableRight) / 2);
  });

  test("web reads the same real insets as native — no fixed fallback pads", () => {
    const f = frameOf();
    assert.equal(f.topPad, insets.top);
    assert.equal(f.bottomPad, insets.bottom);
    assert.equal(f.leftPad, insets.left);
    assert.equal(f.rightPad, insets.right);
  });

  test("the hand gets what the two buttons and their gaps leave", () => {
    const f = frameOf();
    const tableW = 800 - f.tableLeft - f.tableRight;
    assert.equal(f.handAvailW, tableW - (actionBtnSize(1) + HAND_ZONE_GAP) * 2);
  });

  test("the hand row leaves room for both side buttons", () => {
    const f = frameOf();
    assert.ok(f.handAvailW > 0);
    assert.ok(f.handAvailW < 800 - actionBtnSize(1) * 2);
  });

  // A button that shrinks below a thumb on a small phone is a button that gets
  // mis-tapped; a button frozen at 56 on a tablet is a button that shrinks.
  test("the buttons scale up with the table but never below a thumb", () => {
    assert.ok(actionBtnSize(2) > actionBtnSize(1));
    assert.equal(actionBtnSize(0.1), 48);
  });

  test("the hand aims at its share of the width and never stretches past it", () => {
    const f = frameOf({ width: 844 });
    assert.equal(f.handRoomW, 844 * HAND_WIDTH_SHARE);
    // The floor: on this device the share is the tighter of the two, which is
    // the whole point — otherwise the hand would spread across the felt.
    assert.ok(f.handRoomW < f.handAvailW);
  });

  test("a narrow screen falls back to what the row actually has", () => {
    // On a small phone the buttons leave less than the share asks for, and
    // the row cannot be given width that is not there.
    const f = frameOf({ width: 480 });
    assert.equal(f.handRoomW, Math.min(f.handAvailW, 480 * HAND_WIDTH_SHARE));
    assert.ok(f.handRoomW <= f.handAvailW);
  });

  test("the field takes what the seats leave it, capped by its own share", () => {
    const f = frameOf({ width: 844 });
    const tableW = 844 - f.tableLeft - f.tableRight;
    assert.equal(f.fieldRoomW, Math.min(tableW - SIDE_SECTION_W * 2, 844 * 0.55));
    assert.ok(f.fieldRoomW > 0);
    // Neither arc may take the whole table: together they still leave the
    // seats their columns.
    assert.ok(f.fieldRoomW < tableW);
    assert.ok(f.handRoomW < 844);
  });

  // Numbers, not the formula again: restating `min(tableW - 2*SIDE_SECTION_W,
  // share)` passes whatever either term holds, which is how a column twice the
  // prototype's width sat here unnoticed. The small phone is where the seats'
  // own columns bind rather than the share.
  test("the seats' columns are what caps the field on the smallest phone", () => {
    const noInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    const small = computeTableFrame({ width: 568, height: 320, insets: noInsets, scale: 320 / 390 });
    const tableW = 568 - small.tableLeft - small.tableRight;
    assert.equal(Math.round(tableW - SIDE_SECTION_W * 2), 304);
    assert.ok(
      tableW - SIDE_SECTION_W * 2 < 568 * 0.55,
      "the share is meant to be the looser of the two bounds here"
    );
    assert.equal(Math.round(small.fieldRoomW), 304);
  });

});

// ─── Exchange ─────────────────────────────────────────────────────────────────

describe("readExchange", () => {
  const players = [{ name: "A" }, { name: "B" }, { name: "C" }] as any[];
  const withPhase = (phase: any) => ({ players, exchangePhase: phase }) as any;

  test("no phase at all is inactive", () => {
    assert.deepEqual(readExchange(withPhase(undefined), 0, false), INACTIVE_EXCHANGE);
  });

  test("an inactive phase object is still inactive", () => {
    assert.deepEqual(
      readExchange(withPhase({ active: false, winnerIdx: 0, loserIdx: 2 }), 0, false),
      INACTIVE_EXCHANGE
    );
  });

  test("the winner is asked to give, the loser to wait", () => {
    const state = withPhase({ active: true, winnerIdx: 0, loserIdx: 2 });
    const asWinner = readExchange(state, 0, false);
    assert.equal(asWinner.viewerIsWinner, true);
    assert.equal(asWinner.viewerIsLoser, false);
    assert.equal(asWinner.winner, players[0]);
    assert.equal(asWinner.loser, players[2]);

    const asLoser = readExchange(state, 2, false);
    assert.equal(asLoser.viewerIsWinner, false);
    assert.equal(asLoser.viewerIsLoser, true);
  });

  test("a watcher is neither, whichever seat they are drawn from", () => {
    const state = withPhase({ active: true, winnerIdx: 0, loserIdx: 2 });
    for (const seat of [0, 1, 2]) {
      const v = readExchange(state, seat, true);
      assert.equal(v.active, true, `seat ${seat} still sees the phase`);
      assert.equal(v.viewerIsWinner, false, `seat ${seat} was called the winner`);
      assert.equal(v.viewerIsLoser, false, `seat ${seat} was called the loser`);
      assert.equal(v.winner, players[0], `seat ${seat} lost the winner's name`);
      assert.equal(v.loser, players[2], `seat ${seat} lost the loser's name`);
    }
  });

  test("a bystander is neither", () => {
    const v = readExchange(withPhase({ active: true, winnerIdx: 0, loserIdx: 2 }), 1, false);
    assert.equal(v.active, true);
    assert.equal(v.viewerIsWinner, false);
    assert.equal(v.viewerIsLoser, false);
  });

  test("an out-of-range seat resolves to null rather than undefined", () => {
    const v = readExchange(withPhase({ active: true, winnerIdx: 9, loserIdx: 2 }), 9, false);
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

describe("the table holds still at the landing frame", () => {
  test("a landed card gets a beat before its aftermath runs", () => {
    assert.equal(landingHoldMs(false), Hold.land);
  });

  test("no landing, no hold", () => {
    // The contract, not the shipped path: `FlyingCards` returns before it ever
    // reaches the hold under reduced motion. What this pins is that a caller
    // reaching it anyway is answered from the landing rather than from a second
    // reading of the flag, which is the pair that could drift.
    assert.equal(impactDelayMs(true), 0);
    assert.equal(landingHoldMs(true), 0);
  });

  test("the settle waits out the landing and then the hold", () => {
    const src = readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8");
    assert.ok(
      !/FLIGHT_MS\s*\*\s*LANDING_FRACTION/.test(src),
      "pile.tsx must call impactDelayMs(), not recompute the landing"
    );
    // Both terms, in one expression: a call that reaches the hold and discards
    // it leaves the aftermath running on the frame of contact, which is the
    // whole defect.
    assert.ok(
      src.includes("impactDelayMs(reduceMotion) + landingHoldMs(reduceMotion)"),
      "the settle must be delayed by the landing plus the hold"
    );
  });

  test("the flight's safety floor clears the hold it now delays", () => {
    // `FLIGHT_LIMIT_MS` also calls `onDone`. If a longer hold pushed the settle
    // spring past it — which #101's bomb tier is meant to do — the floor would
    // fire first and the pile would advance twice.
    const src = readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8");
    assert.match(src, /const FLIGHT_LIMIT_MS = .*Hold\.land/);
  });
});

describe("a landed card squashes on the spring that lands it", () => {
  test("at rest — settle 0, including the whole of reduced motion — there is no deformation", () => {
    const { x, y } = landSquashScale(0);
    assert.equal(x, 1);
    assert.equal(y, 1);
  });

  test("the peak squash is the named constant, not a literal at the call site", () => {
    assert.ok(LAND_SQUASH < 1, "a squash compresses; it does not grow");
    const { y } = landSquashScale(1);
    assert.equal(y, LAND_SQUASH);
  });

  test("compressing one axis expands the other — volume never drifts, at any point on the spring", () => {
    // Includes a value past 1: `Motion.spring.land` overshoots past 0 once, and
    // that overshoot is the recovery this rides rather than a second timeline.
    for (const settle of [0, 0.25, 0.5, 0.75, 1, -0.07]) {
      const { x, y } = landSquashScale(settle);
      assert.ok(
        Math.abs(x * y - 1) < 1e-9,
        `x*y must stay 1 at settle=${settle}, got ${x * y}`
      );
    }
  });

  test("pile.tsx rides the same settle value Motion.spring.land drives, not a timeline of its own", () => {
    const src = readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8");
    assert.ok(
      src.includes("landSquashScale(settle.value)"),
      "the flying card's squash must read off `settle`, the value the landing spring already drives"
    );
  });
});

describe("settleForMotion", () => {
  // Reanimated's cancelAnimation (the flight effect's own cleanup, re-run
  // when `reduceMotion` flips) freezes a shared value at its current number
  // rather than resetting it, so a live toggle mid-flight cannot rely on
  // `settle` already being 0 by the time reduced motion takes over. These
  // assert the behaviour directly — not a source pin — because the fix lives
  // in a pure function pile.tsx also calls: unpinnable by rendering, though
  // — a probe component mutating a shared value after mount, under this
  // repo's jest-expo reanimated mock, left useAnimatedStyle's output at the
  // value the component mounted with, the same frozen-at-mount trap loops.md
  // documents for reading a value back out. So live reactivity on this exact
  // path still needs an e2e toggle mid-flight or a device check; neither is
  // what these prove.
  test("reduced motion always resets to 0, whatever the incoming value was", () => {
    assert.equal(settleForMotion(true, 0), 0);
    assert.equal(settleForMotion(true, 1), 0);
    assert.equal(settleForMotion(true, -0.07), 0);
  });

  test("off reduced motion the value passes through unchanged", () => {
    assert.equal(settleForMotion(false, 0.42), 0.42);
    assert.equal(settleForMotion(false, 0), 0);
  });

  test("FlyingCards runs it as the first thing its effect does, so a toggle cannot skip past it", () => {
    // Anchored at the effect's own opening brace rather than searched for
    // anywhere in the file: a call present but placed after a branch that
    // returns early would never run under reduced motion — the defect this
    // exists to catch — and an unanchored search cannot tell "runs first"
    // from "is written down somewhere". Comments are blanked first, the way
    // tests/e2eSentinels.test.ts does, so a copy of this exact text left
    // behind in one does not read as the call.
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8")
    );
    assert.match(
      src,
      /useEffect\(\(\) => \{\s*settle\.value = settleForMotion\(reduceMotion, settle\.value\);/
    );
  });
});

describe("the table's own trauma escalation (#763)", () => {
  const DECAY_MS = Motion.duration.shake;

  test("a play's tier reads off the combination that just landed", () => {
    assert.equal(comboImpactTier("bomb"), "bomb");
    assert.equal(comboImpactTier("straight"), "straightFlush");
    assert.equal(comboImpactTier("royal_straight"), "straightFlush");
    assert.equal(comboImpactTier("single"), "ordinary");
    assert.equal(comboImpactTier("pair"), "ordinary");
    assert.equal(comboImpactTier("triple"), "ordinary");
  });

  // The manche rung is `GameState.gameOver` (processPlay: "the hand is
  // decided"), never `roundWinner` — that is a trick, closing many times a
  // hand (docs/RULES.md §9). The partita rung is a further fact about the
  // same landing (`MatchVerdict.over`), not a second, later event.
  describe("landingTier", () => {
    test("a play that closes nothing lands at its own tier", () => {
      assert.equal(landingTier({ comboType: "single", handOver: false, matchOver: false }), "ordinary");
      assert.equal(landingTier({ comboType: "bomb", handOver: false, matchOver: false }), "bomb");
    });

    test("the hand emptying, with the match still open, is the manche rung", () => {
      assert.equal(landingTier({ comboType: "single", handOver: true, matchOver: false }), "mancheWon");
    });

    test("the hand emptying and the match closing with it is the partita rung", () => {
      assert.equal(landingTier({ comboType: "single", handOver: true, matchOver: true }), "partitaWon");
    });

    test("matchOver with handOver false never fires the partita rung — a match cannot close on a hand still in play", () => {
      assert.equal(landingTier({ comboType: "single", handOver: false, matchOver: true }), "ordinary");
    });

    test("a bomb that also closes the manche is only as loud as its loudest rung", () => {
      assert.equal(landingTier({ comboType: "bomb", handOver: true, matchOver: false }), "bomb");
      assert.equal(landingTier({ comboType: "bomb", handOver: true, matchOver: true }), "bomb");
    });
  });

  test("the tier→trauma mapping is the one table #101 settled", () => {
    assert.equal(traumaFor("ordinary", false), 0);
    assert.equal(traumaFor("straightFlush", false), 0);
    assert.equal(traumaFor("bomb", false), Trauma.bomb);
    assert.equal(traumaFor("mancheWon", false), Trauma.mancheWon);
    assert.equal(traumaFor("partitaWon", false), Trauma.partitaWon);
  });

  test("the bomb outranks the manche and the partita both — a later 'tidy-up' that sorts by event size must fail this", () => {
    const bomb = traumaFor("bomb", false);
    const manche = traumaFor("mancheWon", false);
    const partita = traumaFor("partitaWon", false);
    assert.ok(
      bomb > manche,
      "a bomb is a surprise and a manche ending is expected — the bomb shakes harder on purpose"
    );
    assert.ok(bomb > partita, "the bomb outranks even the partita: it is the surprise in the game");
    assert.ok(partita > manche, "a partita closing still outshakes a manche closing");
  });

  // The four probes a blind critique ran against the shipped shake: the
  // reduced-motion zeroing removed outright, applied to only some tiers (one
  // escaping), and answering a small non-zero number instead of true rest.
  // `tests/native/tableShake.test.tsx` cannot red on these — a
  // `useAnimatedStyle` read off a mounted node is frozen at whatever it was
  // at mount (`settleForMotion`, above, documents the same trap) — so they
  // are pinned here, directly against the pure functions, the way #783 did.
  test("reduced motion produces no shake, at every tier, without a bespoke branch", () => {
    const tiers: ImpactTier[] = ["ordinary", "straightFlush", "bomb", "mancheWon", "partitaWon"];
    for (const tier of tiers) {
      assert.equal(traumaFor(tier, true), 0, `${tier} must carry no trauma under reduced motion`);
    }
  });

  test("reduced motion answers exactly 0, not merely a small number", () => {
    assert.ok(
      Object.is(traumaFor("partitaWon", true), 0),
      "a fix that shrinks trauma instead of zeroing it would still shake, just less"
    );
  });

  test("trauma at rest (elapsed 0) is the tier's own trauma squared — Trauma, lib/tokens.ts", () => {
    const peak = shakeMagnitude(Trauma.bomb, 0, DECAY_MS);
    assert.ok(
      Math.abs(peak - Trauma.bomb * Trauma.bomb) < 1e-9,
      `the shake starts struck at trauma squared (${Trauma.bomb * Trauma.bomb}), got ${peak}`
    );
  });

  test("the tiers separate quadratically, not linearly — a bomb stands further above a manche than the raw trauma table shows", () => {
    const bomb = shakeMagnitude(Trauma.bomb, 0, DECAY_MS);
    const manche = shakeMagnitude(Trauma.mancheWon, 0, DECAY_MS);
    const rawRatio = Trauma.bomb / Trauma.mancheWon;
    const squaredRatio = bomb / manche;
    assert.ok(
      squaredRatio > rawRatio + 1e-9,
      `squaring trauma must widen the bomb-over-manche gap past its raw ${rawRatio}, got ${squaredRatio}`
    );
  });

  test("trauma decays squared, not linearly — a half-elapsed shake is a quarter strength, not half", () => {
    const peak = shakeMagnitude(Trauma.bomb, 0, DECAY_MS);
    const half = shakeMagnitude(Trauma.bomb, DECAY_MS / 2, DECAY_MS);
    assert.ok(
      Math.abs(half - peak * 0.25) < 1e-9,
      `the decay squared at the midpoint must be a quarter of the peak, got ${half}`
    );
  });

  test("the shake is fully decayed at and past its own decay window, never negative", () => {
    assert.equal(shakeMagnitude(Trauma.bomb, DECAY_MS, DECAY_MS), 0);
    assert.equal(shakeMagnitude(Trauma.bomb, DECAY_MS * 4, DECAY_MS), 0);
  });

  test("reduced motion's own decay window (0) is rest, never a division by zero", () => {
    assert.equal(shakeMagnitude(Trauma.bomb, 0, 0), 0);
    assert.equal(shakeOffset(Trauma.bomb, 0, 0, 1).x, 0);
    assert.equal(shakeOffset(Trauma.bomb, 0, 0, 1).y, 0);
  });

  test("no trauma is no displacement, at any point in the decay", () => {
    assert.equal(shakeOffset(0, 0, DECAY_MS, 1).x, 0);
    assert.equal(shakeOffset(0, 0, DECAY_MS, 1).y, 0);
    assert.equal(shakeOffset(0, DECAY_MS / 3, DECAY_MS, 1).x, 0);
  });

  test("the displacement peaks at the tier's own trauma, at the moment of impact", () => {
    const { x, y } = shakeOffset(Trauma.bomb, 0, DECAY_MS, 1);
    // cos(0) = 1, so the wiggle contributes its full weight at elapsed 0.
    assert.ok(x !== 0 && y !== 0, "a bomb's shake must actually move the node it is applied to");
  });

  // #790: kick (useTableFeedback.ts) multiplies its jolts by the table's own
  // scale, so the same shake reads as a small fraction of a phone and a huge
  // one of a tablet unless it scales the same way.
  test("the displacement scales with the table, the way kick's own jolts do", () => {
    const atOne = shakeOffset(Trauma.bomb, 0, DECAY_MS, 1);
    const atDouble = shakeOffset(Trauma.bomb, 0, DECAY_MS, 2);
    assert.ok(
      Math.abs(atDouble.x - atOne.x * 2) < 1e-9,
      `doubling the table's scale must double the shake's own displacement, got ${atOne.x} then ${atDouble.x}`
    );
    assert.ok(Math.abs(atDouble.y - atOne.y * 2) < 1e-9);
  });

  test("the decay window comes from Motion, and the amplitudes from Spacing — never a bare literal", () => {
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "gameTableModel.ts"), "utf8")
    );
    assert.doesNotMatch(
      src,
      /const SHAKE_AMPLITUDE_[XY]\s*=\s*\d/,
      "a shake amplitude must read a Spacing step, not a pixel literal"
    );
  });
});

describe("the bomb's peak, re-tuned against #789's corrected curve (#796)", () => {
  const DECAY_MS = Motion.duration.shake;
  // The base short edge `cardScale` (components/cardFaceModel.ts) is authored
  // at, and the phone/tablet short edges the critic on #795 read the
  // regression at.
  const BASE_EDGE = 390;
  const PHONE_EDGE = 320;
  const TABLET_EDGE = 834;

  /**
   * `kick` (components/useTableFeedback.ts) fires on every landing,
   * unconditionally, and rides the same table scale the shake does — so a
   * player's felt impact is the two summed, never the shake alone. Read its
   * peak jolt from source rather than a second copy of the numbers, so a
   * change to `KICK_JOLTS` cannot leave this floor stale.
   */
  function kickPeakJolt(): { x: number; y: number } {
    const src = readFileSync(path.join(repoRoot, "components", "useTableFeedback.ts"), "utf8");
    const jolts = [...src.matchAll(/\{ x: (-?\d+), y: (-?\d+), ms: [^}]+\}/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    assert.ok(jolts.length > 0, "expected to find KICK_JOLTS entries in useTableFeedback.ts");
    return {
      x: Math.max(...jolts.map((j) => Math.abs(j.x))),
      y: Math.max(...jolts.map((j) => Math.abs(j.y))),
    };
  }

  function combinedBombPeak(shortEdge: number) {
    const scale = shortEdge / BASE_EDGE;
    const kick = kickPeakJolt();
    const shake = shakeOffset(Trauma.bomb, 0, DECAY_MS, scale);
    return { x: kick.x * scale + Math.abs(shake.x), y: kick.y * scale + Math.abs(shake.y) };
  }

  // What a bomb's shake alone displaced before #789 corrected the decay curve
  // — a fixed pixel amount, unscaled by the table (#790's own bug) — at the
  // amplitude constants shipped then. #796's own measurement on #795's PR.
  const PRE_CORRECTION_SHAKE_X = Trauma.bomb * 16;
  const PRE_CORRECTION_SHAKE_Y = Trauma.bomb * 10;

  function preCorrectionCombined(shortEdge: number) {
    const scale = shortEdge / BASE_EDGE;
    const kick = kickPeakJolt();
    return {
      x: kick.x * scale + PRE_CORRECTION_SHAKE_X,
      y: kick.y * scale + PRE_CORRECTION_SHAKE_Y,
    };
  }

  for (const [label, shortEdge] of [
    ["phone", PHONE_EDGE],
    ["base", BASE_EDGE],
    ["tablet", TABLET_EDGE],
  ] as const) {
    test(`a bomb's combined landing (shake plus kick) is at least what it felt before #789's curve correction — ${label}`, () => {
      const before = preCorrectionCombined(shortEdge);
      const after = combinedBombPeak(shortEdge);
      assert.ok(
        after.x >= before.x,
        `${label}: expected the re-tuned peak to clear the pre-correction floor of ${before.x.toFixed(2)}px on x, got ${after.x.toFixed(2)}px`
      );
      assert.ok(
        after.y >= before.y,
        `${label}: expected the re-tuned peak to clear the pre-correction floor of ${before.y.toFixed(2)}px on y, got ${after.y.toFixed(2)}px`
      );
    });
  }
});

// ─── Flight origin ────────────────────────────────────────────────────────────

describe("flightOrigin", () => {
  // Deliberately asymmetric left/right pads, so a test that happens to pass
  // only because the table is centred cannot hide here.
  const base = {
    scale: 1,
    windowWidth: 800,
    windowHeight: 600,
    tableLeft: 40,
    tableRight: 20,
    tableTop: 10,
    surplus: 0,
    handZoneH: 100,
    topDisplayedCount: 0,
    sideDisplayedCount: 0,
  };

  test("bottom: the throw starts at the hand row's own vertical centre", () => {
    // handRowCenterY = windowHeight - handZoneH/2 = 600-50 = 550;
    // topSectionH (no fan) = 79, pileCenterY = 294.5 (worked in the `top`
    // test below, which shares this same pile centre); dy = 550-294.5 = 255.5.
    assert.deepEqual(flightOrigin({ ...base, dir: "bottom" }), { dx: 0, dy: 255.5 });
  });

  test("bottom: the pile's own centre, not a fixed constant, is what scale moves through", () => {
    // seatLabelH(2)=92, ringSize(2)=66, topSectionH=158; midH=590-158-100=332;
    // pileCenterY=10+158+166=334; handRowCenterY is unchanged at 550 (handZoneH
    // is a caller-measured input here, not itself a function of scale); dy=216.
    assert.equal(flightOrigin({ ...base, dir: "bottom", scale: 2 }).dy, 216);
  });

  test("top: dx is 0 — the top seat and the pile share the same horizontal centre", () => {
    assert.equal(flightOrigin({ ...base, dir: "top" }).dx, 0);
  });

  test("top: the throw starts above the pile, at the ring's own line", () => {
    // Worked by hand from seatLabelH/SEAT_DISC/CHIP_H/Spacing — see the ADR.
    // seatLabelH(1) = 17 + gap 2 + pad 4 + CHIP_H(1)=23 = 46; ringSize = 33.
    // topSectionH (no fan) = 46 + 33 = 79; contentH = 600-10 = 590;
    // midH = 590-79-100 = 411; pileCenterY = 10+79+411/2 = 294.5;
    // ringCenterY = 10+46+33/2 = 72.5; dy = 72.5-294.5 = -222.
    assert.equal(flightOrigin({ ...base, dir: "top" }).dy, -222);
  });

  test("top: a bigger held fan pushes the pile down, lengthening the throw", () => {
    const noFan = flightOrigin({ ...base, dir: "top", topDisplayedCount: 0 }).dy;
    const withFan = flightOrigin({ ...base, dir: "top", topDisplayedCount: 5 }).dy;
    // The ring never moves; only the pile does, so the gap between them grows.
    assert.ok(withFan < noFan, `expected the throw to lengthen: ${withFan} was not < ${noFan}`);
  });

  test("top: the fan's own cap means a held count past it changes nothing further", () => {
    const atCap = flightOrigin({ ...base, dir: "top", topDisplayedCount: FAN_DRAWN_CARDS.top });
    const wayPastCap = flightOrigin({ ...base, dir: "top", topDisplayedCount: 21 });
    assert.deepEqual(wayPastCap, atCap);
  });

  test("top: a held fan's own height is folded into the pile's offset, not just its sign", () => {
    // Same solve `topFanHeight` performs internally (`seatFanArc`), so this
    // pins the arithmetic that combines it with `seatLabelH`/`SEAT_DISC`/
    // `seatGap`, not the geometry of the solve itself.
    const topDisplayedCount = 3;
    const fanH = seatFanArc(topDisplayedCount, BACK_SCALE).bounds.h;
    const topSectionH = seatLabelH(1) + SEAT_DISC + seatGap(1) + fanH;
    const contentH = base.windowHeight - base.tableTop;
    const midH = contentH - topSectionH - base.handZoneH;
    const pileCenterY = base.tableTop + topSectionH + midH / 2;
    const ringCenterY = base.tableTop + seatLabelH(1) + SEAT_DISC / 2;
    assert.equal(
      flightOrigin({ ...base, dir: "top", topDisplayedCount }).dy,
      ringCenterY - pileCenterY
    );
  });

  test("left/right: the throw starts at the side seat's own ring, high in the band", () => {
    // The seat's column is anchored to the top of the mid band, so its ring
    // rides the slot's centre while the pile rides the band's: the throw starts
    // above the pile by half the difference.
    const topSectionH = seatLabelH(1) + SEAT_DISC;
    const midH = base.windowHeight - base.tableTop - topSectionH - base.handZoneH;
    const dy = (sideSlotHeight(1, 0) - midH) / 2;
    assert.ok(dy < 0, `a raised seat throws downward into the pile: ${dy}`);
    assert.equal(flightOrigin({ ...base, dir: "left" }).dy, dy);
    assert.equal(flightOrigin({ ...base, dir: "right" }).dy, dy);
  });

  test("left: the throw starts at the ring flush against the rail", () => {
    // tableW = 800-40-20 = 740; pileCenterX = 40+370 = 410;
    // ringCenterX = 40 + Spacing.sm(8) + SEAT_DISC/2(16.5) = 64.5; dx = -345.5.
    assert.equal(flightOrigin({ ...base, dir: "left" }).dx, -345.5);
  });

  test("right: the throw starts at the ring flush against the opposite edge", () => {
    assert.equal(flightOrigin({ ...base, dir: "right" }).dx, 345.5);
  });

  test("left and right are mirror images of the same pile centre, however asymmetric the rail is", () => {
    const left = flightOrigin({ ...base, dir: "left" }).dx;
    const right = flightOrigin({ ...base, dir: "right" }).dx;
    assert.equal(left + right, 0);
  });

  test("SEAT_DISC and FAN_DRAWN_CARDS.top are the numbers a throw's origin is measured against", () => {
    // Pinned so a change to either is a deliberate edit here too, not a
    // silent drift between the seat's own rendering and the throw's origin.
    assert.equal(SEAT_DISC, 33);
    assert.equal(FAN_DRAWN_CARDS.top, 7);
  });

  // A copy of SEAT_DISC also holds the pinned value above, so that assertion
  // alone can never see one — only the source scan can (same reasoning as the
  // CARD_W/CARD_H scan further up this file).
  test("SEAT_DISC is declared in gameTableModel.ts and nowhere else", () => {
    const SEAT_DISC_DECL = /(?<![\w$])(?:const|let|var)\s+SEAT_DISC(?![\w$])/g;
    assert.deepEqual(scan(SEAT_DISC_DECL), ["components/gameTableModel.ts: const SEAT_DISC"]);
  });
});

describe("sparkOffset", () => {
  test("16 sparks ring the impact, evenly spaced", () => {
    assert.equal(SPARK_COUNT, 16);
  });

  test("the first spark flies straight out along +x, unsquashed there", () => {
    const s = sparkOffset(0, 1);
    assert.equal(s.dx, 110);
    assert.equal(s.dy, 0);
    assert.equal(s.delay, 60);
  });

  test("a quarter turn round the ring flies +y, squashed to .62", () => {
    // i = 4: angle = (4/16)*2π = π/2, distance = 110 + (4%4)*34 = 110.
    const s = sparkOffset(4, 1);
    assert.ok(Math.abs(s.dx) < 1e-9);
    assert.equal(Math.round(s.dy), 68); // 110 * 0.62
  });

  test("distance steps every 4th spark, delay every 5th — the two cycles fall out of phase", () => {
    const near = sparkOffset(0, 1);
    const far = sparkOffset(1, 1);
    assert.equal(Math.hypot(near.dx, near.dy / 0.62), 110);
    assert.equal(Math.hypot(far.dx, far.dy / 0.62), 144); // 110 + 34
    assert.equal(sparkOffset(5, 1).delay, 60); // (5 % 5) === 0, same as spark 0
  });

  test("distance scales with the table; delay is a stagger and never does", () => {
    const s = sparkOffset(0, 2);
    assert.equal(s.dx, 220);
    assert.equal(s.delay, 60);
  });

  test("every spark before SPARK_COUNT has a distinct angle", () => {
    const angles = new Set<string>();
    for (let i = 0; i < SPARK_COUNT; i++) {
      const s = sparkOffset(i, 1);
      angles.add(Math.atan2(s.dy / 0.62, s.dx).toFixed(6));
    }
    assert.equal(angles.size, SPARK_COUNT);
  });
});

describe("fanCounts", () => {
  test("under cap: identical to subtracting departing from the capped total", () => {
    assert.deepEqual(fanCounts(4, 2, 5), { remaining: 2, departing: 2 });
  });

  test("no flight: everything held is drawn, nothing departs", () => {
    assert.deepEqual(fanCounts(4, 0, 5), { remaining: 4, departing: 0 });
  });

  test("at cap: the fan stays at cap through the flight instead of dipping and popping back", () => {
    // A left seat holding 10 that plays 3: the post-play hand is 7, still past
    // the cap of 5, so the fan never had fewer than 5 to show and nothing
    // should visibly depart.
    assert.deepEqual(fanCounts(10, 3, 5), { remaining: 5, departing: 0 });
  });

  test("crossing the cap: only the room the play actually freed up departs", () => {
    // Pre-play 6 (1 over cap of 5) playing 3 drops the hand to 3, under cap —
    // the fan does shrink, but the seat only ever drew 5 backs to begin with,
    // so only 2 of the 3 played cards were ever drawn as one.
    assert.deepEqual(fanCounts(6, 3, 5), { remaining: 3, departing: 2 });
  });
});


describe("the portrait cover's glyph", () => {
  test("stands upright at the start and lies down at the end", () => {
    assert.equal(rotateGlyphAngle(ROTATE_UPRIGHT), 90);
    assert.equal(rotateGlyphAngle(ROTATE_SETTLED), 0);
  });

  test("parks in the pose it is asking for, not the one the player is in", () => {
    // The whole point of the still frame: a glyph parked upright shows the
    // player what they already have.
    assert.notEqual(rotateGlyphAngle(ROTATE_SETTLED), rotateGlyphAngle(ROTATE_UPRIGHT));
    assert.equal(rotateGlyphAngle(ROTATE_SETTLED), 0);
  });

  test("turns without doubling back", () => {
    const path = [0, 0.25, 0.5, 0.75, 1].map(rotateGlyphAngle);
    for (let i = 1; i < path.length; i++) {
      assert.ok(path[i]! < path[i - 1]!, "the glyph reverses part-way through its turn");
    }
  });
});

// ─── Who the viewer is ────────────────────────────────────────────────────────

describe("viewerOwnsSeat", () => {
  test("a seated player owns the seat they are drawn from", () => {
    assert.equal(viewerOwnsSeat(2, 2, false), true);
    assert.equal(viewerOwnsSeat(1, 2, false), false);
  });

  test("a watcher owns none of them", () => {
    for (const seat of [0, 1, 2, 3]) {
      assert.equal(viewerOwnsSeat(seat, seat, true), false, `seat ${seat} was owned`);
    }
  });
});

// `viewerOwnsSeat` is the only place identity is decided. `readExchange` takes
// `spectating` as a required argument, so tsc names any caller that forgets it;
// these are the screens, where the question would otherwise be asked by hand.
//
// `===` only: `seat !== viewerSeat` is "everyone else", which is how the
// opponent list and the seat ring are built and is right for a watcher too.
test("no screen asks whether a seat is the viewer's by hand", () => {
  const IDENTITY = new RegExp(
    String.raw`(?:===\s*(?:viewerSeat|mySeatIndex)\b)|(?:\b(?:viewerSeat|mySeatIndex)\s*===)`
  );
  const asked: string[] = [];
  for (const rel of ["components/GameTable.tsx", "app/(online)/game.tsx", "app/(online)/replay.tsx"]) {
    readFileSync(path.join(repoRoot, rel), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (IDENTITY.test(line)) asked.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }

  assert.deepEqual(
    asked,
    [],
    `a watcher's seat answers yes to these: ${asked.join(" | ")}. ` +
      `Use viewerOwnsSeat(seat, viewerSeat, spectating) from components/gameTableModel.`
  );
});

// ─── The cutout, and the side the rail is on ─────────────────────────────────

describe("cutoutClass", () => {
  // The three classes do not overlap in what iOS reports, so one inset answers
  // the question and no device table is needed (docs/research/
  // 2026-08-26-notch-and-dynamic-island.md).
  test("names each of the three device classes from its reported inset", () => {
    for (const [inset, expected] of [
      [0, "none"], [20, "none"], [44, "notch"], [50, "notch"], [59, "island"], [68, "island"],
    ] as const) {
      assert.equal(cutoutClass(inset), expected, `an inset of ${inset} is a ${expected} cutout`);
    }
  });

  // The boundaries are the whole of this function: a threshold that drifts by a
  // point reclassifies a real phone, and nothing else would notice.
  test("the boundaries fall between the reported ranges, not inside one", () => {
    for (const [inset, expected] of [
      [29, "none"], [30, "notch"], [54, "notch"], [55, "island"],
    ] as const) {
      assert.equal(cutoutClass(inset), expected, `the boundary moved: ${inset} read as ${cutoutClass(inset)}`);
    }
  });

  test("a value below zero or absurdly large still answers", () => {
    assert.equal(cutoutClass(-1), "none");
    assert.equal(cutoutClass(200), "island");
  });
});

describe("computeTableFrame, mirrored", () => {
  const insets = { top: 20, bottom: 10, left: 59, right: 59 };
  const frameOf = (railSide: "left" | "right") =>
    computeTableFrame({ width: 800, height: 390, insets, scale: 1, railSide });

  // The point of the ticket: rotate the phone and the cutout moves to the other
  // side, so the rail has to follow it. Everything about the frame is the same
  // shape either way — only the edges swap.
  test("the right-hand frame is the left-hand one with its edges swapped", () => {
    const l = frameOf("left");
    const r = frameOf("right");

    assert.equal(r.rail, l.rail, "the rail changed width when it changed sides");
    assert.equal(r.tableRight, l.tableLeft, "the rail is not against the right edge");
    assert.equal(r.tableLeft, l.tableRight, "the play area does not start where the rail is not");
  });

  test("the play area is the same width whichever side the rail is on", () => {
    const l = frameOf("left");
    const r = frameOf("right");
    assert.equal(800 - r.tableLeft - r.tableRight, 800 - l.tableLeft - l.tableRight);
    assert.equal(r.handAvailW, l.handAvailW);
    assert.equal(r.fieldRoomW, l.fieldRoomW);
  });

  // The defect this replaces: the rail was grown from `insets.left` whatever the
  // rotation, so in the rotation with the Island on the right the app reserved
  // the cutout's width twice — once as a rail nothing sits behind, once as
  // right-edge padding — and the cutout sat over the padding rather than
  // between the two knobs.
  test("the rail is grown from the inset on its own side", () => {
    const lopsided = { top: 20, bottom: 10, left: 0, right: 59 };
    const r = computeTableFrame({ width: 800, height: 390, insets: lopsided, scale: 1, railSide: "right" });
    assert.equal(r.rail, railWidth(59, 1), "a right-hand rail was grown from the left inset");

    const l = computeTableFrame({ width: 800, height: 390, insets: lopsided, scale: 1, railSide: "left" });
    assert.equal(l.rail, railWidth(0, 1), "a left-hand rail was grown from the right inset");
  });

  test("the play area's centre is the box's own centre on either side", () => {
    for (const side of ["left", "right"] as const) {
      const f = computeTableFrame({ width: 844, height: 390, insets, scale: 1, railSide: side });
      const boxCentre = f.tableLeft + (844 - f.tableLeft - f.tableRight) / 2;
      assert.equal(boxCentre, (f.tableLeft + 844 - f.tableRight) / 2, side);
    }
  });

  test("a frame asked for no side at all still puts the rail on the left", () => {
    const f = computeTableFrame({ width: 800, height: 390, insets, scale: 1 });
    assert.equal(f.tableLeft, f.rail);
  });
});

describe("railSideForOrientation", () => {
  // The table locks to landscape but not to one landscape direction, so the
  // rail's side is a function of the rotation and of nothing else.
  test("the two landscape rotations put the rail on opposite sides", () => {
    assert.equal(railSideForOrientation(LANDSCAPE_LEFT), "left", "the named rotation lost its side");
    assert.notEqual(
      railSideForOrientation(LANDSCAPE_LEFT + 1),
      "left",
      "both rotations put the rail on the same side, so it never follows the cutout"
    );
  });

  // Portrait and unknown reach this only in the moment before the lock takes,
  // and either side is wrong then; what must not happen is a crash or an
  // undefined that reaches a style.
  test("every other value still answers with a side", () => {
    for (const o of [0, 1, 2, 99]) {
      assert.ok(["left", "right"].includes(railSideForOrientation(o)), String(o));
    }
  });
});

describe("railSideFor", () => {
  const OTHER = LANDSCAPE_LEFT + 1;

  // The knobs only change hands when there is something to follow. A notchless
  // phone flipping would move them for no gain, and the rail already clears a
  // notch without growing, so only an island moves anything.
  test("a phone with no cutout keeps the rail where it was", () => {
    assert.equal(railSideFor(0, LANDSCAPE_LEFT), "left");
    assert.equal(railSideFor(0, OTHER), "left", "a notchless phone moved its knobs on rotation");
    assert.equal(railSideFor(20, OTHER), "left", "a notchless phone moved its knobs on rotation");
  });

  test("a phone with a cutout follows the rotation", () => {
    for (const inset of [44, 59, 68]) {
      assert.notEqual(
        railSideFor(inset, LANDSCAPE_LEFT),
        railSideFor(inset, OTHER),
        `an inset of ${inset} put the rail on the same side in both rotations`
      );
    }
  });
});

// ─── exchangeFlight ───────────────────────────────────────────────────────────
//
// The exchange flies two cards at once, each from a seat to the other seat, and
// the pair must never overlap on screen. That is the one claim a unit test can
// make about it — where each card is at every moment is arithmetic — while
// whether the rendered boxes actually stay apart is `tests/e2e/`'s job, because
// react-test-renderer never runs layout.

describe("exchangeFlight", () => {
  const frame = {
    scale: 1,
    windowWidth: 800,
    windowHeight: 600,
    tableLeft: 40,
    tableRight: 20,
    tableTop: 10,
    surplus: 0,
    handZoneH: 100,
    topDisplayedCount: 0,
  };
  // Different counts on the two sides, so a left⇄right trip that used one seat's
  // slot height for both ends cannot pass here.
  const sideDisplayedCounts = { left: 2, right: 9 };
  // A real card is far taller than it is wide, which is the whole reason the
  // clearance cannot be a single number: a pair passing one above the other
  // needs the taller dimension between them.
  const cardW = 60;
  const cardH = 84;
  /** Every ordered pair of distinct seats — the diagonals included. */
  const SEATS = ["top", "bottom", "left", "right"] as const;
  const PAIRS = SEATS.flatMap((from) =>
    SEATS.filter((to) => to !== from).map((to) => [from, to] as const)
  );

  const sideCount = (d: "top" | "bottom" | "left" | "right") =>
    d === "left" || d === "right" ? sideDisplayedCounts[d] : 0;

  const dist = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) =>
    Math.hypot(a.dx - b.dx, a.dy - b.dy);

  /** Points along one trip: out to the meeting, held there, then on. */
  const walk = (f: ReturnType<typeof exchangeFlight>) => {
    const lerp = (a: { dx: number; dy: number }, b: { dx: number; dy: number }, t: number) => ({
      dx: a.dx + (b.dx - a.dx) * t,
      dy: a.dy + (b.dy - a.dy) * t,
    });
    const STEPS = 20;
    const out = Array.from({ length: STEPS + 1 }, (_, i) => lerp(f.from, f.meet, i / STEPS));
    const back = Array.from({ length: STEPS + 1 }, (_, i) => lerp(f.meet, f.to, i / STEPS));
    return [...out, ...back];
  };

  /** Overlapping area of two cards centred at `a` and `b`, in px². */
  const boxOverlap = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) => {
    const w = cardW - Math.abs(a.dx - b.dx);
    const h = cardH - Math.abs(a.dy - b.dy);
    return w > 0 && h > 0 ? w * h : 0;
  };

  test("a card leaves its owner's seat and arrives at the other one", () => {
    for (const [from, to] of PAIRS) {
      const flight = exchangeFlight({ ...frame, sideDisplayedCounts, from, to, cardW, cardH });
      const origin = flightOrigin({ ...frame, dir: from, sideDisplayedCount: sideCount(from) });
      const destination = flightOrigin({ ...frame, dir: to, sideDisplayedCount: sideCount(to) });
      // The trip is derived from the same source the throw animation uses, so
      // a card starts and ends at that seat's own point — offset into its lane,
      // and no further than the lane itself is wide.
      const lane = Math.max(cardW, cardH);
      assert.ok(
        dist(flight.from, origin) <= lane,
        `${from} → ${to} starts ${dist(flight.from, origin).toFixed(0)}px from the ${from} seat`
      );
      assert.ok(
        dist(flight.to, destination) <= lane,
        `${from} → ${to} ends ${dist(flight.to, destination).toFixed(0)}px from the ${to} seat`
      );
      // …and both ends are displaced identically, which is what makes it a
      // lane rather than a drift.
      assert.deepEqual(
        { dx: +(flight.from.dx - origin.dx).toFixed(9), dy: +(flight.from.dy - origin.dy).toFixed(9) },
        { dx: +(flight.to.dx - destination.dx).toFixed(9), dy: +(flight.to.dy - destination.dy).toFixed(9) },
        `${from} → ${to}: the two ends are offset differently`
      );
    }
  });

  test("the two cards of one exchange never overlap, at any point of the trip", () => {
    for (const [from, to] of PAIRS) {
      const out = exchangeFlight({ ...frame, sideDisplayedCounts, from, to, cardW, cardH });
      const back = exchangeFlight({ ...frame, sideDisplayedCounts, from: to, to: from, cardW, cardH });
      // Every moment of the trip, not only the beat at the middle. Two lanes
      // that only part where they meet still cross on the way there, and a
      // browser saw exactly that (tests/e2e/exchangeNoOverlap.spec.ts) while an
      // assertion about the meeting point alone reported everything fine.
      //
      // Boxes, not centres, for the same reason: two centres a card *width*
      // apart are clear of each other only when the gap runs across the card.
      const collisions = walk(out)
        .map((a, i) => ({ i, area: boxOverlap(a, walk(back)[i]) }))
        .filter((c) => c.area > 0);
      assert.deepEqual(
        collisions.map((c) => `step ${c.i}: ${c.area.toFixed(0)}px²`),
        [],
        `${from} ⇄ ${to}: the two cards overlap while they travel.`
      );
    }
  });

  test("the meeting point sits between the two seats, not past either of them", () => {
    for (const [from, to] of PAIRS) {
      const flight = exchangeFlight({ ...frame, sideDisplayedCounts, from, to, cardW, cardH });
      const whole = dist(flight.from, flight.to);
      // A meet outside the trip is a card that overshoots and doubles back —
      // it reads as a miss rather than as a handover.
      assert.ok(
        dist(flight.from, flight.meet) < whole && dist(flight.meet, flight.to) < whole,
        `${from} → ${to}: the meeting point is not between the seats`
      );
    }
  });

  test("the lane runs across the trip, so neither card is sent short or long", () => {
    for (const [from, to] of PAIRS) {
      const flight = exchangeFlight({ ...frame, sideDisplayedCounts, from, to, cardW, cardH });
      const travel = { x: flight.to.dx - flight.from.dx, y: flight.to.dy - flight.from.dy };
      // The lane is reported rather than recovered from the three points: all
      // three carry it, so any difference between them has it cancelled out.
      const along =
        (travel.x * flight.lane.dx + travel.y * flight.lane.dy) / Math.hypot(travel.x, travel.y);
      assert.ok(
        Math.abs(along) < 1e-9,
        `${from} → ${to}: the lane is displaced ${along.toFixed(2)}px along the ` +
          `trip rather than across it, which changes when the card arrives`
      );
      assert.ok(
        Math.hypot(flight.lane.dx, flight.lane.dy) > 0,
        `${from} → ${to}: the trip has no lane, so anything placed off it lands on it`
      );
    }
  });

  test("a bigger card is given proportionally more room, not a fixed gap", () => {
    const trip = (cardW: number, cardH: number) =>
      exchangeFlight({ ...frame, sideDisplayedCounts, from: "bottom", to: "top", cardW, cardH });
    const width = (f: ReturnType<typeof exchangeFlight>) => Math.hypot(f.lane.dx, f.lane.dy);
    assert.ok(
      width(trip(120, 168)) > width(trip(40, 56)),
      "the clearance is a fixed distance rather than the card's own reach"
    );
  });
});

// What the table leaves a place for while the flight carrying it is still on
// screen (#672).
describe("arrivingCard", () => {
  const GIVEN = { id: "6_clubs", suit: "clubs", rank: "6", isJoker: false } as const;
  const RECEIVED = { id: "2_spades", suit: "spades", rank: "2", isJoker: false } as const;
  const announce = {
    winnerName: "Ana",
    loserName: "Bea",
    winnerIdx: 1,
    loserIdx: 3,
    bothJokersException: false,
    cardGiven: GIVEN,
    cardReceived: RECEIVED,
  };

  // The two ends are not symmetric: each seat is receiving the other's card.
  test("the winner is receiving what was taken off the loser", () => {
    assert.deepEqual(arrivingCard(announce, 1), RECEIVED);
  });

  test("the loser is receiving what the winner chose", () => {
    assert.deepEqual(arrivingCard(announce, 3), GIVEN);
  });

  test("a seat outside the trade receives nothing", () => {
    for (const seat of [0, 2]) {
      assert.equal(arrivingCard(announce, seat), undefined, `seat ${seat} was given a card`);
    }
  });

  test("a spectator receives nothing", () => {
    assert.equal(arrivingCard(announce, null), undefined);
  });

  test("both Jokers cancelling the exchange delivers nothing to either seat", () => {
    const cancelled = { ...announce, bothJokersException: true };
    for (const seat of [1, 3]) {
      assert.equal(arrivingCard(cancelled, seat), undefined, `seat ${seat} was given a card`);
    }
  });

  test("no ceremony, nothing arriving", () => {
    assert.equal(arrivingCard(null, 1), undefined);
    assert.equal(arrivingCard(undefined, 1), undefined);
  });

  test("neither seat is told the card it is giving away", () => {
    assert.notDeepEqual(arrivingCard(announce, 1), GIVEN);
    assert.notDeepEqual(arrivingCard(announce, 3), RECEIVED);
  });

  // The one window in which the hand does not draw its traded card, from the
  // exchange opening to the flight landing (#650).
  describe("readHandArrival", () => {
    const KEPT = { id: "9_clubs", suit: "clubs", rank: "9", isJoker: false } as const;
    const hand = [KEPT, RECEIVED] as Card[];
    const winnersPrompt = {
      ...INACTIVE_EXCHANGE,
      active: true,
      viewerIsWinner: true,
      cardFromLoser: RECEIVED as Card,
    };
    const read = (over: Partial<Parameters<typeof readHandArrival>[0]>) =>
      readHandArrival({
        hand,
        exchange: INACTIVE_EXCHANGE,
        announce: null,
        viewerSeat: 1,
        landed: false,
        reduceMotion: false,
        ...over,
      });

    test("nothing is held back outside an exchange", () => {
      assert.deepEqual(read({}), {
        withheldId: undefined,
        arrivingIndex: undefined,
        descendingId: undefined,
      });
    });

    // The engine gives the winner the card as the phase opens and the prompt
    // draws it on the felt, so the fan must not draw it too.
    test("the winner's prompt holds the card back without parting the row", () => {
      const at = read({ exchange: winnersPrompt });
      assert.equal(at.withheldId, RECEIVED.id);
      assert.equal(at.arrivingIndex, undefined, "the row parts for a flight, not for a prompt");
    });

    test("the loser is holding nothing back while the winner chooses", () => {
      const watching = { ...winnersPrompt, viewerIsWinner: false, viewerIsLoser: true };
      assert.equal(read({ exchange: watching }).withheldId, undefined);
    });

    test("the flight parts the row at the card's own place in the hand", () => {
      const at = read({ announce });
      assert.equal(at.withheldId, RECEIVED.id);
      assert.equal(at.arrivingIndex, 1);
      assert.equal(at.descendingId, RECEIVED.id);
    });

    // A ceremony naming a card the hand does not hold would otherwise open a
    // gap nothing ever descends into.
    test("a card the hand does not hold parts nothing", () => {
      const at = read({ announce, hand: [KEPT] as Card[] });
      assert.equal(at.arrivingIndex, undefined);
    });

    test("the landing gives the card back, and still names it for its mount", () => {
      const at = read({ announce, landed: true });
      assert.equal(at.withheldId, undefined, "the hand draws it the moment it lands");
      assert.equal(at.descendingId, RECEIVED.id, "…and it travels in on that same render");
    });

    // Nothing flies, so nothing is ever missing from the row.
    test("reduced motion holds nothing back for a flight", () => {
      const at = read({ announce, reduceMotion: true });
      assert.equal(at.withheldId, undefined);
      assert.equal(at.arrivingIndex, undefined);
      assert.equal(at.descendingId, undefined);
    });

    // …but the prompt's duplicate is a correctness defect rather than motion.
    test("reduced motion still holds back the card the prompt is drawing", () => {
      assert.equal(
        read({ exchange: winnersPrompt, reduceMotion: true }).withheldId,
        RECEIVED.id
      );
    });

    test("a spectator's synthetic hand is left alone", () => {
      const at = read({ announce, viewerSeat: null });
      assert.equal(at.withheldId, undefined);
      assert.equal(at.descendingId, undefined);
    });
  });
});

describe("readThrownPlay", () => {
  const card = (id: string) =>
    ({ id, suit: "clubs", rank: "5", isJoker: false }) as Card;
  const seat = (id: string, cards: number) =>
    ({
      id,
      name: id,
      type: "ai",
      hand: Array.from({ length: cards }, (_, i) => card(`${id}_${i}`)),
    }) as unknown as Player;

  const PAIR = { type: "pair", cards: [card("x"), card("y")], strength: 5 } as Combination;
  const BOMB = { type: "bomb", cards: [card("b")], strength: 9 } as Combination;

  /** Four seats, the viewer at 0, everyone still holding cards. */
  const table = (thrower: number, throwerCards = 6) => {
    const players = [seat("me", 5), seat("right", 6), seat("top", 7), seat("left", 8)];
    players[thrower] = seat(["me", "right", "top", "left"][thrower]!, throwerCards);
    return players;
  };

  const read = (players: Player[], playedBy: number, combo = PAIR) =>
    readThrownPlay({
      combo,
      playedBy,
      viewerSeat: 0,
      players,
      opponents: arrangeOpponents(players, 0),
      scale: 1,
      windowWidth: 844,
      windowHeight: 390,
      tableLeft: 20,
      tableRight: 20,
      tableTop: 12,
      surplus: 0,
      bottomPad: 8,
      handCardH: 90,
    });

  test("the cards are the combination's own, thrown from the seat that played it", () => {
    const thrown = read(table(2), 2);
    assert.deepEqual(thrown.cards, PAIR.cards);
    assert.equal(thrown.dir, "top");
  });

  test("a bomb and a royal straight land heavier than anything else", () => {
    assert.equal(read(table(2), 2, BOMB).heavy, true);
    assert.equal(
      read(table(2), 2, { type: "royal_straight", cards: [card("r")], strength: 9 } as Combination)
        .heavy,
      true
    );
    assert.equal(read(table(2), 2).heavy, false);
  });

  test("the flush is owed only when the throw left the hand empty", () => {
    assert.equal(read(table(2, 0), 2).emptiedHand, true, "the thrower has nothing left");
    assert.equal(read(table(2, 1), 2).emptiedHand, false, "one card is not none");
  });

  test("a throw from the top seat starts where that seat's pre-play fan put it", () => {
    assert.notDeepEqual(
      read(table(2, 1), 2).origin,
      read(table(2, 5), 2).origin,
      "the top seat's own count has to reach the origin, or the pile cannot be placed under it"
    );
  });

  /**
   * The fan draws at most `FAN_DRAWN_CARDS.top`, so past that the column stops
   * growing and the pile stops moving. Pinned because the test above would
   * pass for the wrong reason at any two counts on this side of the cap.
   */
  test("past the drawn cap the column stops growing, so the pile stops moving", () => {
    assert.deepEqual(read(table(2, 7), 2).origin, read(table(2, 11), 2).origin);
  });

  test("each seat throws from its own side", () => {
    const players = table(1);
    const origins = [1, 2, 3].map((s) => ({
      dir: read(players, s).dir,
      dx: read(players, s).origin.dx,
    }));
    assert.deepEqual(
      origins.map((o) => o.dir),
      ["right", "top", "left"]
    );
    assert.ok(origins[0]!.dx > 0, "the right seat throws from the right");
    assert.ok(origins[2]!.dx < 0, "the left seat throws from the left");
    assert.equal(origins[1]!.dx, 0, "the top seat throws straight down the middle");
  });
});
