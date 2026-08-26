// Pure logic behind the shared game table (components/GameTable.tsx), extracted
// into components/gameTableModel.ts so `node --test` can load it — the table
// itself is .tsx and cannot be type-stripped by Node's loader.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CARD_H, CARD_W, BACK_SCALE } from "../components/cardFaceModel.ts";
import { TOUCH_TARGET_MIN } from "../lib/tokens.ts";
import {
  actionBtnSize,
  HAND_ZONE_GAP,
  CHIP_H,
  SIDE_SECTION_W,
  HAND_CROP,
  HAND_WIDTH_SHARE,
  HAND_ZONE_H,
  handVisibleH,
  cardTilt,
  getOpponentPosition,
  seatDirection,
  arrangeOpponents,
  handCountOf,
  displayedHandCount,
  fanCounts,
  flightOrigin,
  seatFanArc,
  SEAT_DISC,
  SEAT_GAP,
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
  readExchange,
  INACTIVE_EXCHANGE,
  describeTableForA11y,
  impactDelayMs,
  FLIGHT_MS,
  LANDING_FRACTION,
  passedSeats,
  straightTopRankChar,
  sparkOffset,
  SPARK_COUNT,
  type ComboShape,
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

  test("the hand zone keeps its +16 headroom for the selection lift, at any card height", () => {
    // The -16px selection lift has to fit inside the zone above the cards; the
    // 16px of slack is what gives it room without clipping.
    for (const h of [CH * 0.7, CH, CH * 1.2]) {
      assert.equal(HAND_ZONE_H(h, 0), handVisibleH(h) + 16);
      assert.ok(HAND_ZONE_H(h, 0) - handVisibleH(h) >= 16);
    }
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
    const top = notificationTopOffset({ topPad, landscape: true, scale: 1 });
    assert.ok(top >= topPad + CHIP_H(1), `${top} still overlaps the chips`);
  });

  test("portrait — every menu screen — is left exactly where it was", () => {
    assert.equal(notificationTopOffset({ topPad, landscape: false, scale: 1 }), topPad);
  });

  test("a zero inset still clears the chips in landscape", () => {
    assert.ok(notificationTopOffset({ topPad: 0, landscape: true, scale: 1 }) >= CHIP_H(1));
  });

  test("scales with the table, so a tablet's banner clears a tablet's chips", () => {
    const one = notificationTopOffset({ topPad, landscape: true, scale: 1 });
    const two = notificationTopOffset({ topPad, landscape: true, scale: 2 });
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
    computeTableFrame({ width: 800, insets, scale: 1, ...over });

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
    handZoneH: 100,
    topDisplayedCount: 0,
  };

  test("bottom: the throw starts at the hand row's own vertical centre", () => {
    // handRowCenterY = windowHeight - handZoneH/2 = 600-50 = 550;
    // topSectionH (no fan) = 77, pileCenterY = 293.5 (worked in the `top`
    // test below, which shares this same pile centre); dy = 550-293.5 = 256.5.
    assert.deepEqual(flightOrigin({ ...base, dir: "bottom" }), { dx: 0, dy: 256.5 });
  });

  test("bottom: the pile's own centre, not a fixed constant, is what scale moves through", () => {
    // seatLabelH(2)=84, ringSize(2)=66, topSectionH=150; midH=590-150-100=340;
    // pileCenterY=10+150+170=330; handRowCenterY is unchanged at 550 (handZoneH
    // is a caller-measured input here, not itself a function of scale); dy=220.
    assert.equal(flightOrigin({ ...base, dir: "bottom", scale: 2 }).dy, 220);
  });

  test("top: dx is 0 — the top seat and the pile share the same horizontal centre", () => {
    assert.equal(flightOrigin({ ...base, dir: "top" }).dx, 0);
  });

  test("top: the throw starts above the pile, at the ring's own line", () => {
    // Worked by hand from seatLabelH/SEAT_DISC/CHIP_H/Spacing — see the ADR.
    // seatLabelH(1) = 17 + CHIP_H(1)=23 + Spacing.xs=4 = 44; ringSize = 33.
    // topSectionH (no fan) = 44 + 33 = 77; contentH = 600-10 = 590;
    // midH = 590-77-100 = 413; pileCenterY = 10+77+413/2 = 293.5;
    // ringCenterY = 10+44+33/2 = 70.5; dy = 70.5-293.5 = -223.
    assert.equal(flightOrigin({ ...base, dir: "top" }).dy, -223);
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
    // `SEAT_GAP`, not the geometry of the solve itself.
    const topDisplayedCount = 3;
    const fanH = seatFanArc(topDisplayedCount, BACK_SCALE).bounds.h;
    const topSectionH = seatLabelH(1) + SEAT_DISC + SEAT_GAP + fanH;
    const contentH = base.windowHeight - base.tableTop;
    const midH = contentH - topSectionH - base.handZoneH;
    const pileCenterY = base.tableTop + topSectionH + midH / 2;
    const ringCenterY = base.tableTop + seatLabelH(1) + SEAT_DISC / 2;
    assert.equal(
      flightOrigin({ ...base, dir: "top", topDisplayedCount }).dy,
      ringCenterY - pileCenterY
    );
  });

  test("left/right: dy is 0 — a side seat's ring sits on the same line as the pile", () => {
    assert.equal(flightOrigin({ ...base, dir: "left" }).dy, 0);
    assert.equal(flightOrigin({ ...base, dir: "right" }).dy, 0);
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

