// What a thrown card does between the hand it left and the pile it lands on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CARD_H,
  BACK_SCALE,
  HAND_SCALE,
  cardScale,
} from "../components/cardFaceModel.ts";
import {
  Hold,
  Trauma,
  Motion,
  Spacing,
} from "../lib/tokens.ts";
import type { Card, Combination } from "../lib/gameEngine.ts";
import {
  HAND_ZONE_H,
  arrangeOpponents,
  type FlyDirection,
  sideSlotHeight,
  seatFanArc,
  SEAT_DISC,
  seatGap,
  seatLabelH,
  FAN_DRAWN_CARDS,
} from "../components/seatLayout.ts";
import {
  cardTilt,
  arrivingCard,
  readHandArrival,
  readThrownPlay,
  flightOrigin,
  exchangeFlight,
  comboKey,
  advancePile,
  roundClosedWithWinner,
  EMPTY_PILE,
  readExchange,
  INACTIVE_EXCHANGE,
  impactDelayMs,
  landingHoldMs,
  landSquashScale,
  LAND_SQUASH,
  settleForMotion,
  comboImpactTier,
  landingTier,
  traumaFor,
  flinchFor,
  shakeMagnitude,
  shakeOffset,
  shakeAmplitudeFor,
  FLIGHT_MS,
  LANDING_FRACTION,
  passedSeats,
  sparkOffset,
  SPARK_COUNT,
  flareKindFor,
  sparksFor,
  lampLiftFor,
  type ImpactTier,
  type FlareKind,
} from "../components/flightPhysics.ts";
import { computeTableFrame } from "../components/tableFrame.ts";
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
import { blankComments, clientSources, componentSources, scanSources } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scan = (pattern: RegExp) => scanSources(pattern, clientSources(repoRoot));

// A module-level `..._MS` constant assigned a literal — the shape every
// escape from `Motion`/`Reading`/`Hold` takes (#829). `eslint.config.js`
// refuses a bare number for a timing but not a number behind a name, so this
// is what the linter cannot see: FLIGHT_MS derived from `Motion.duration`
// does not match (the `=` is followed by `Motion`, not a digit), which is the
// point — a name alone is not an escape, only a name holding its own number.
const MOTION_ESCAPE_DECL =
  /^[ \t]*(?:export\s+)?(?:const|let|var)\s+[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_MS(?:\s*:\s*number)?\s*=(?=\s*\d)/gm;


const combo = (ids: string[]): any => ({
  type: "single",
  strength: 1,
  cards: ids.map((id) => ({ id })),
});


/** Four seats, all still holding cards. */
const ALL_IN = [false, false, false, false];


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


describe("impact feedback is timed to the card landing, not to the throw", () => {
  test("a played card takes 213ms to reach the pile", () => {
    // Sound, haptics and the bomb shake are scheduled against this. When they
    // fired at throw time instead, the bang arrived a third of a second before
    // the card that caused it.
    //
    // FLIGHT_MS derives from Motion.duration.travel (#829): the throw and the
    // scale's own travel step had drifted to three different numbers (260 in
    // Motion, 300 in the Scale mockup, 380 here) for what #126 settled once.
    assert.equal(FLIGHT_MS, 260);
    assert.equal(LANDING_FRACTION, 0.82);
    assert.equal(impactDelayMs(false), 213);
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

//
// #829 judged every `_MS` constant in components/ against the scale and left
// the pile below one of two ways: renamed onto Motion/Reading, or kept with a
// comment stating why it is a one-off (ROUND_WINNER_MS, SPARK_LEAD_MS and
// SPARK_PHASE_MS are the pattern to match). This is the count that judgement
// left standing — not zero, CLAUDE.md allows a component-local one-off — so
// that the next one added is a decision this test makes someone write down,
// rather than a drift nobody notices until the next audit.
describe("a duration off the scale is a counted decision, not a silent drift", () => {
  test("components/ holds exactly the number #829 left", () => {
    const hits = scanSources(MOTION_ESCAPE_DECL, componentSources(repoRoot));
    assert.equal(
      hits.length,
      23,
      "a `_MS` constant was added to (or removed from) components/ — fold it onto " +
        "Motion/Reading/Hold, or update this pin with a comment at the constant saying " +
        "why it stays a one-off:\n" + hits.join("\n")
    );
  });

  test("the scan fires on a real declaration, not just this file's fixtures", () => {
    // The exact shape #829 found and fixed: a bare literal behind a name,
    // before FLIGHT_MS was made to derive from Motion.duration.travel.
    const planted: [string, string][] = [
      ["components/table/example.tsx", "export const FLIGHT_MS = 380;"],
    ];
    assert.deepEqual(scanSources(MOTION_ESCAPE_DECL, planted), [
      "components/table/example.tsx: export const FLIGHT_MS =",
    ]);
  });

  test("a step derived from Motion is not an escape", () => {
    const planted: [string, string][] = [
      ["components/table/example.tsx", "export const FLIGHT_MS: number = Motion.duration.travel;"],
    ];
    assert.deepEqual(scanSources(MOTION_ESCAPE_DECL, planted), []);
  });

  test("a comment or a string holding the same text is not a declaration", () => {
    // Text presence is not reachability: a decoy that only a naive scan would fall for.
    const planted: [string, string][] = [
      [
        "components/table/example.tsx",
        [
          "// const EXAMPLE_MS = 500; — left as a note, never declared",
          '  const label = "const EXAMPLE_MS = 500;";',
        ].join("\n"),
      ],
    ];
    assert.deepEqual(scanSources(MOTION_ESCAPE_DECL, planted), []);
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
      readFileSync(path.join(repoRoot, "components", "flightPhysics.ts"), "utf8")
    );
    assert.doesNotMatch(
      src,
      /const (BOMB_)?SHAKE_AMPLITUDE_[XY]\s*=\s*\d/,
      "a shake amplitude must read a Spacing step, not a pixel literal"
    );
  });
});

describe("the beaten pile's flinch (#764)", () => {
  const ALL_TIERS: ImpactTier[] = ["ordinary", "straightFlush", "bomb", "mancheWon", "partitaWon"];

  test("the tier→displacement mapping reads the same five tiers #763's trauma table does", () => {
    assert.equal(flinchFor("ordinary", false), 0);
    assert.equal(flinchFor("straightFlush", false), Spacing.xxs);
    assert.equal(flinchFor("bomb", false), Spacing.slim);
    assert.equal(flinchFor("mancheWon", false), Spacing.slim);
    assert.equal(flinchFor("partitaWon", false), Spacing.slim);
  });

  test("a straight or flush still displaces what it beat — only the ordinary win is silent", () => {
    assert.ok(
      flinchFor("straightFlush", false) > flinchFor("ordinary", false),
      "the land spring's own overshoot is the whole effect for an ordinary win, but a straight or flush must visibly give ground"
    );
  });

  test("bomb, manche and partita all knock the beaten pile the same distance — the escalation past the bomb rides the shake and the hold, not a bigger knock", () => {
    assert.equal(flinchFor("bomb", false), flinchFor("mancheWon", false));
    assert.equal(flinchFor("mancheWon", false), flinchFor("partitaWon", false));
  });

  test("reduced motion answers exactly 0 at every tier, without a bespoke branch", () => {
    for (const tier of ALL_TIERS) {
      assert.ok(
        Object.is(flinchFor(tier, true), 0),
        `${tier} must carry no flinch under reduced motion, and answer true rest rather than a small number`
      );
    }
  });

  test("the mapping reads Spacing, never a bare pixel literal", () => {
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "flightPhysics.ts"), "utf8")
    );
    const table = src.match(/const FLINCH_BY_TIER: Record<ImpactTier, number> = \{[\s\S]*?\};/);
    assert.ok(table, "expected a FLINCH_BY_TIER table in flightPhysics.ts");
    assert.doesNotMatch(
      table![0],
      /:\s*[1-9]\d*/,
      "a non-zero flinch displacement must read a Spacing step, not a pixel literal"
    );
  });

  // #764's own ticket: this exact shape shipped inert twice — a flinch that
  // fires but moves nothing a player can see. Pinning the wiring rather than
  // just the pure function is what would have caught that.
  test("the flinch fires from the same impactDelayMs() landing the shake and the impact sound wait for — never a second derivation", () => {
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "GameTable.tsx"), "utf8")
    );
    const block = src.match(
      /impactTimerRef\.current = setTimeout\(\(\) => \{[\s\S]*?\}, impactDelayMs\(reduceMotion\)\);/
    );
    assert.ok(block, "expected the impact timeout in GameTable.tsx");
    assert.match(block![0], /shake\(tier\)/, "the shake must read the same tier the flinch does");
    assert.match(
      block![0],
      /setFlinchTrigger/,
      "the flinch must be triggered from this same landing, not a later one"
    );
  });

  // A second blind critique defeated a source-scan version of this same check
  // (matching `translateY: PILE_PREV_Y + flinchY.value` as text anywhere in
  // the file) with a decoy function holding the same literal text elsewhere,
  // and separately by dropping the static `-7deg` resting rotate outright —
  // both passed every test here. A scan proves the text is present, not that
  // it is reachable from the rendered node; `tests/native/pileFlinch.test.tsx`
  // mounts `PlayedPile`, bumps `flinchTrigger`, and reads the beaten layer's
  // actual transform, which is the only thing that can tell the two apart.

  // A blind critique caught this exact shape: every test above stayed green
  // while the flinch was rewired onto `current`, the landing combination,
  // instead of `prev`, the one it beat — the whole point of the ticket. A
  // string search for "prevLayerStyle" anywhere in the file cannot catch
  // that; only asking which JSX branch carries it can.
  test("the flinch lands on the beaten layer (prev), never on the new one — the whole point of the ticket", () => {
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8")
    );
    const stack = src.match(/<View style=\{pileStyles\.pileStack\}>[\s\S]*?<\/View>/);
    assert.ok(stack, "expected the pile's own stacking View");
    const prevBlock = stack![0].match(/\{prev &&[\s\S]*?\)\}/);
    const currentBlock = stack![0].match(/\{current &&[\s\S]*?\)\}/);
    assert.ok(prevBlock, "expected the prev-combo JSX branch inside the stack");
    assert.ok(currentBlock, "expected the current-combo JSX branch inside the stack");
    assert.match(
      prevBlock![0],
      /prevLayerStyle/,
      "the flinch's own animated style must be applied to the beaten layer"
    );
    assert.doesNotMatch(
      currentBlock![0],
      /prevLayerStyle|flinchY/,
      "the flinch must never reach the landing combination — displacing prev is the whole point of #764"
    );
  });

  // A blind critique's own measurement: shipped at a fixed 2px/6px, the
  // flinch was under half its intended share of the table at a tablet's
  // short edge (834) against the base one (390) this scale is authored
  // against (components/cardFaceModel.ts). `shakeOffset` and `kick`
  // (useTableFeedback.ts) both read as a fraction of the table for the same
  // reason: a fixed pixel count reads huge on a phone and vanishes on a
  // tablet (#790).
  test("the flinch's own distance scales with the table, the way shakeOffset scales trauma", () => {
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8")
    );
    assert.match(
      src,
      /flinchFor\(flinchTier \?\? "ordinary", reduceMotion\) \* scale/,
      "the flinch's own trigger must multiply flinchFor's answer by the table's own scale"
    );
  });

  // The critique found this exact defect twice more in the same file: the
  // pile's own land-spring overshoot (the ordinary tier's whole effect) and
  // FlyingCards' own settle dip were both fixed pixel counts too. Fixed
  // alongside the flinch rather than left as the next instance of the class.
  test("the pile's own bounce and FlyingCards' own land dip scale with the table too — the same defect class, fixed alongside the flinch", () => {
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8")
    );
    assert.match(
      src,
      /-PILE_BOUNCE_DIP \* scale/,
      "PlayedPile's own bounce (the ordinary tier's whole effect) must scale with the table"
    );
    assert.match(
      src,
      /settle\.value \* LAND_DIP \* scale/,
      "FlyingCards' own settle dip must scale with the table"
    );
  });
});

describe("the lamp's flare and lift (#765)", () => {
  const ALL_TIERS: ImpactTier[] = ["ordinary", "straightFlush", "bomb", "mancheWon", "partitaWon"];

  test("the graduated table #101 settled: only the bomb and the partita flare and spark", () => {
    const expected: Record<ImpactTier, FlareKind> = {
      ordinary: "none",
      straightFlush: "none",
      bomb: "brief",
      mancheWon: "none",
      partitaWon: "settle",
    };
    for (const tier of ALL_TIERS) {
      assert.equal(flareKindFor(tier), expected[tier], `${tier} flare kind`);
    }
  });

  test("a straight or flush lands at its own tier and gets neither a flare nor a spark", () => {
    // The rung this ticket's own tier table names "Ordinary win, straight /
    // flush" — the row `comboImpactTier` calls "straightFlush", never a bomb.
    assert.equal(flareKindFor("straightFlush"), "none");
    assert.equal(sparksFor("straightFlush"), false);
  });

  test("sparksFor never disagrees with flareKindFor — every tier that flares also sparks", () => {
    for (const tier of ALL_TIERS) {
      assert.equal(sparksFor(tier), flareKindFor(tier) !== "none", `${tier} spark/flare must agree`);
    }
  });

  test("only the manche rung lifts the lamp — the row that hands over to the banner instead of flaring", () => {
    for (const tier of ALL_TIERS) {
      assert.equal(lampLiftFor(tier), tier === "mancheWon", `${tier} lamp lift`);
    }
  });

  test("no tier both lifts and flares — the lamp does one or the other, never both", () => {
    for (const tier of ALL_TIERS) {
      assert.ok(
        !(lampLiftFor(tier) && flareKindFor(tier) !== "none"),
        `${tier} must not both lift and flare`
      );
    }
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

  const ALL_TIERS: ImpactTier[] = ["ordinary", "straightFlush", "bomb", "mancheWon", "partitaWon"];

  test("only the bomb reads a different peak — every other tier shares one amplitude", () => {
    const bomb = shakeAmplitudeFor("bomb");
    for (const tier of ALL_TIERS) {
      if (tier === "bomb") continue;
      assert.deepEqual(
        shakeAmplitudeFor(tier),
        shakeAmplitudeFor("ordinary"),
        `${tier} must read the same shared peak as every other non-bomb tier`
      );
      assert.notDeepEqual(
        shakeAmplitudeFor(tier),
        bomb,
        `${tier} must not have picked up the bomb's own boosted peak`
      );
    }
  });

  test("the bomb's own peak is strictly larger on both axes than the shared one", () => {
    const bomb = shakeAmplitudeFor("bomb");
    const shared = shakeAmplitudeFor("mancheWon");
    assert.ok(bomb.x > shared.x, `expected the bomb's x peak (${bomb.x}) to exceed the shared one (${shared.x})`);
    assert.ok(bomb.y > shared.y, `expected the bomb's y peak (${bomb.y}) to exceed the shared one (${shared.y})`);
  });

  function bombShake(shortEdge: number, elapsedMs: number) {
    const scale = shortEdge / BASE_EDGE;
    return shakeOffset(Trauma.bomb, elapsedMs, DECAY_MS, scale, shakeAmplitudeFor("bomb"));
  }

  // What a bomb's shake alone displaced before #789 corrected the decay curve
  // — a fixed pixel amount, unscaled by the table (#790's own bug) — at the
  // amplitude constants shipped then. #796's own measurement on #795's PR.
  //
  // `kick` (components/useTableFeedback.ts) is a separate jolt this ticket
  // does not touch, gated to `heavy` plays and reported alongside this floor
  // in the PR body — never folded into the assertion here: added identically
  // to both sides of a `>=` it would cancel, proving nothing about either.
  const PRE_CORRECTION_SHAKE_X = Trauma.bomb * 16;
  const PRE_CORRECTION_SHAKE_Y = Trauma.bomb * 10;

  for (const [label, shortEdge] of [
    ["phone", PHONE_EDGE],
    ["base", BASE_EDGE],
    ["tablet", TABLET_EDGE],
  ] as const) {
    test(`a bomb's own shake, at contact, is at least what it displaced before #789's curve correction — ${label}`, () => {
      const after = bombShake(shortEdge, 0);
      assert.ok(
        Math.abs(after.x) >= PRE_CORRECTION_SHAKE_X,
        `${label}: expected the re-tuned peak to clear the pre-correction floor of ${PRE_CORRECTION_SHAKE_X.toFixed(2)}px on x, got ${Math.abs(after.x).toFixed(2)}px`
      );
      assert.ok(
        Math.abs(after.y) >= PRE_CORRECTION_SHAKE_Y,
        `${label}: expected the re-tuned peak to clear the pre-correction floor of ${PRE_CORRECTION_SHAKE_Y.toFixed(2)}px on y, got ${Math.abs(after.y).toFixed(2)}px`
      );
    });
  }

  test("a manche or partita closed by an ordinary combination — no kick to lean on — keeps exactly the shake it had before this ticket", () => {
    for (const tier of ["mancheWon", "partitaWon"] as const) {
      const scale = PHONE_EDGE / BASE_EDGE;
      const untouched = shakeOffset(traumaFor(tier, false), 0, DECAY_MS, scale);
      const withThisTicketsHelper = shakeOffset(traumaFor(tier, false), 0, DECAY_MS, scale, shakeAmplitudeFor(tier));
      assert.deepEqual(
        withThisTicketsHelper,
        untouched,
        `${tier}'s shake must read the same peak with or without #796's amplitude lookup — only the bomb gets one`
      );
    }
  });

  test("the bomb's re-tuned shake still decays to rest across its own window, not to a raised floor", () => {
    const atContact = bombShake(PHONE_EDGE, 0);
    const midway = bombShake(PHONE_EDGE, DECAY_MS / 2);
    const spent = bombShake(PHONE_EDGE, DECAY_MS);
    assert.ok(
      Math.abs(midway.x) < Math.abs(atContact.x),
      `expected the boosted peak to have decayed by the midpoint, got ${midway.x} against a peak of ${atContact.x}`
    );
    assert.equal(spent.x, 0, "the boosted peak must still reach exactly 0 once its decay window has run");
    assert.equal(spent.y, 0, "the boosted peak must still reach exactly 0 once its decay window has run");
  });

  test("a leaked trauma under reduced motion cannot reach the bomb's boosted amplitude", () => {
    // `motionMs("shake", true)` already answers a decay window of 0, and
    // `shakeMagnitude`'s own `decayMs <= 0` guard zeroes the output before
    // `trauma` is ever multiplied in — asserting through that decay window
    // would pass no matter what `traumaFor` answered, boosted amplitude or
    // not. A non-zero decay window here means only `traumaFor`'s own answer,
    // run through the bomb's larger peak, is under test.
    const scale = PHONE_EDGE / BASE_EDGE;
    const trauma = traumaFor("bomb", true);
    const { x, y } = shakeOffset(trauma, 0, DECAY_MS, scale, shakeAmplitudeFor("bomb"));
    assert.equal(x, 0, "the boosted amplitude must not turn a leaked trauma into visible displacement");
    assert.equal(y, 0, "the boosted amplitude must not turn a leaked trauma into visible displacement");
  });
});


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
  test("SEAT_DISC is declared in seatLayout.ts and nowhere else", () => {
    const SEAT_DISC_DECL = /(?<![\w$])(?:const|let|var)\s+SEAT_DISC(?![\w$])/g;
    assert.deepEqual(scan(SEAT_DISC_DECL), ["components/seatLayout.ts: const SEAT_DISC"]);
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

  // #817: the owner read "got 2 of Diamonds" over his own hand, dark on a card
  // face. The label used to sit at the landing point, and for the viewer's own
  // seat that point is the hand zone's own centre (`flightOrigin`, "bottom").
  describe("the seat labels", () => {
    const tripFor = (from: FlyDirection, to: FlyDirection) =>
      exchangeFlight({ ...frame, sideDisplayedCounts, from, to, cardW, cardH });

    // The owner's own window as well as the reference one, measured the way the
    // table measures it: a notched phone in landscape is tighter than the frame
    // above in every direction, and its seats hold a full deal rather than a
    // couple of cards — which is what puts a fan where a label wants to be.
    const PHONE = { width: 844, height: 390 };
    const phoneScale = cardScale(Math.min(PHONE.width, PHONE.height));
    const phoneFrame = computeTableFrame({
      ...PHONE,
      insets: { top: 0, bottom: 21, left: 59, right: 0 },
      scale: phoneScale,
      railSide: "left",
    });
    const GEOMETRIES = [
      { name: "the reference window", g: frame, sides: sideDisplayedCounts },
      {
        name: "a notched phone",
        g: {
          scale: phoneScale,
          windowWidth: PHONE.width,
          windowHeight: PHONE.height,
          tableLeft: phoneFrame.tableLeft,
          tableRight: phoneFrame.tableRight,
          tableTop: phoneFrame.tableTop,
          surplus: phoneFrame.surplus,
          handZoneH: HAND_ZONE_H(CARD_H(phoneScale * HAND_SCALE), phoneFrame.bottomPad),
          // Four seats, a fresh deal, thirteen cards each.
          topDisplayedCount: 13,
        },
        sides: { left: 13, right: 13 },
      },
    ];

    test("the label stops short of the seat it names, on every trip", () => {
      for (const [from, to] of PAIRS) {
        const flight = tripFor(from, to);
        const tag = flight.tag;
        const trip = dist(flight.from, flight.to);
        // Measured along the trip alone: the lane offset is across it and
        // would otherwise flatter the distance without moving the label off
        // the seat's cards at all.
        const ux = (flight.to.dx - flight.from.dx) / trip;
        const uy = (flight.to.dy - flight.from.dy) / trip;
        const short =
          (flight.to.dx - tag.dx) * ux + (flight.to.dy - tag.dy) * uy;
        assert.ok(
          short >= cardH,
          `${from} → ${to}: the label sits ${short.toFixed(0)}px short of the landing, ` +
            `inside a ${cardH}px card`
        );
        // …and still on that seat's own half, or it is naming the wrong end.
        assert.ok(
          short < trip / 2,
          `${from} → ${to}: the label fell back past the middle of the table`
        );
      }
    });

    test("the two labels stay a whole lane apart, as the two cards do", () => {
      for (const [from, to] of PAIRS) {
        const there = tripFor(from, to).tag;
        const back = tripFor(to, from).tag;
        assert.ok(
          dist(there, back) > Math.max(cardW, cardH),
          `${from} ⇄ ${to}: the two labels are ${dist(there, back).toFixed(0)}px apart`
        );
      }
    });

    test("the label is off the lane its own card landed on", () => {
      for (const [from, to] of PAIRS) {
        const flight = tripFor(from, to);
        const tag = flight.tag;
        assert.ok(
          boxOverlap(tag, flight.to) === 0,
          `${from} → ${to}: the label overlaps the card it describes`
        );
      }
    });

    // Every seat's, not only its own: the label is placed off one trip, and a
    // trip knows nothing about the two seats it does not touch. Their cards are
    // where their own would land, which is what `flightOrigin` answers.
    test("the label is clear of every seat's cards, not only the pair trading", () => {
      for (const geom of GEOMETRIES) {
        const seatCard = (dir: FlyDirection) =>
          flightOrigin({
            ...geom.g,
            dir,
            sideDisplayedCount: dir === "left" || dir === "right" ? geom.sides[dir] : 0,
          });
        for (const [from, to] of PAIRS) {
          const tag = exchangeFlight({
            ...geom.g,
            sideDisplayedCounts: geom.sides,
            from,
            to,
            cardW,
            cardH,
          }).tag;
          for (const seat of SEATS) {
            assert.ok(
              boxOverlap(tag, seatCard(seat)) === 0,
              `${geom.name}, ${from} → ${to}: the label sits on the ${seat} seat's own cards`
            );
          }
        }
      }
    });

    // A trip standing off its lane can reach past the table it is drawn on: the
    // lane's own offset is perpendicular to the travel, so on a diagonal it
    // carries the label sideways as well as along, and the seat it names is
    // already at the edge.
    test("the label stays on the felt the seats are drawn on, and off the hand", () => {
      for (const geom of GEOMETRIES) {
        const pileX = geom.g.tableLeft + (geom.g.windowWidth - geom.g.tableLeft - geom.g.tableRight) / 2;
        // The hand zone's own centre, from the same helper the flight uses —
        // so the band the label must stay above is half a hand zone above it.
        const handTop =
          flightOrigin({ ...geom.g, dir: "bottom", sideDisplayedCount: 0 }).dy - geom.g.handZoneH / 2;
        for (const [from, to] of PAIRS) {
          const tag = exchangeFlight({
            ...geom.g,
            sideDisplayedCounts: geom.sides,
            from,
            to,
            cardW,
            cardH,
          }).tag;
          const x = pileX + tag.dx;
          assert.ok(
            x > geom.g.tableLeft && x < geom.g.windowWidth - geom.g.tableRight,
            `${geom.name}, ${from} → ${to}: the label's centre is at x ${x.toFixed(0)}, ` +
              `outside the table (${geom.g.tableLeft.toFixed(0)}…` +
              `${(geom.g.windowWidth - geom.g.tableRight).toFixed(0)})`
          );
          assert.ok(
            tag.dy < handTop,
            `${geom.name}, ${from} → ${to}: the label's centre is ` +
              `${(tag.dy - handTop).toFixed(0)}px into the player's own hand`
          );
        }
      }
    });
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

// The flier retiring and the hand taking its card back are two views reading
// one instant; a second `useTradedCardsLanded` call is a second clock for it,
// and a clock that can drift from the one everything else reads is exactly
// how the exchange's own flying card and the hand's arrival came to disagree
// about when the trip is over (#533, reopened 2026-09-02: a residue outliving
// the exchange). GameTable.tsx is the one call; every other view reads its
// answer through a prop.
describe("the exchange landing has one clock", () => {
  const CALL = /(?<!function\s)\buseTradedCardsLanded\s*\(/g;
  const HOME = "lib/sharedGameFlow.ts";

  test("GameTable is the only caller of useTradedCardsLanded", () => {
    assert.deepEqual(scan(CALL), ["components/GameTable.tsx: useTradedCardsLanded("]);
  });

  test("the scan fires on a second caller", () => {
    const planted: [string, string][] = [
      [HOME, "export function useTradedCardsLanded(a, b) { return true; }"],
      ["components/ExchangeAnnouncement.tsx", "const landed = useTradedCardsLanded(visible, x);"],
    ];
    assert.deepEqual(scanSources(CALL, planted), [
      "components/ExchangeAnnouncement.tsx: useTradedCardsLanded(",
    ]);
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
