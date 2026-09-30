// What a thrown card does between the hand it left and the pile it lands on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BACK_SCALE } from "../../components/cardFaceModel.ts";
import {
  Trauma,
  Motion,
  Spacing,
} from "../../lib/tokens.ts";
import type { Card, Combination } from "../../lib/game/gameEngine.ts";
import { LEG, legPose, type LegStage } from "../../lib/game/exchangeTimeline.ts";
import type { CardFrom } from "../../components/flightPose.ts";
import {
  arrangeOpponents,
  HAND_ZONE_H,
  SEAT_DISC,
  seatGap,
  seatLabelH,
  FAN_DRAWN_CARDS,
} from "../../components/seatLayout.ts";
import { drawnFanBounds, fanPoint, seatFanArc } from "../../components/fanGeometry.ts";
import { sideSlotHeight, topBandHeight } from "../../components/tableFrame.ts";
import {
  arrivingCard,
  readHandArrival,
  readTradeSeats,
  NO_STAGES,
  JOKERS,
  readThrownPlay,
  readExchangeLegs,
  anchorPoints,
  tableGeometry,
  type SeatPlace,
  type TableGeometry,
  flightOrigin,
  comboKey,
  seatPoint,
  roundClosedWithWinner,
  readExchange,
  INACTIVE_EXCHANGE,
  landWobble,
  LAND_WOBBLE_MS,
  comboImpactTier,
  landingTier,
  traumaFor,
  flinchFor,
  shakeMagnitude,
  shakeOffset,
  shakeAmplitudeFor,
  passedSeats,
  sparkOffset,
  SPARK_COUNT,
  flareKindFor,
  sparksFor,
  lampLiftFor,
  type ImpactTier,
  type FlareKind,
} from "../../components/flightPhysics.ts";
import {
  buildCombination,
  processPass,
  processPlay,
  c,
  makePlayer,
  makeState,
  type GameState,
  type Player,
} from "../engine/helpers.ts";
import {
  blankComments,
  blankCommentsAndStrings,
  clientSources,
  scanSources,
} from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const scan = (pattern: RegExp) => scanSources(pattern, clientSources(repoRoot));

const readPile = () =>
  blankCommentsAndStrings(readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8"));

/** Every call to `callee` in `src`: its span and its top-level arguments. */
function calls(src: string, callee: string): { start: number; end: number; args: string[] }[] {
  const out: { start: number; end: number; args: string[] }[] = [];
  for (const m of src.matchAll(new RegExp(`(?<![\\w$.])${callee}\\(`, "g"))) {
    const open = m.index! + m[0].length - 1;
    const args: string[] = [];
    let depth = 0;
    let from = open + 1;
    for (let i = open; i < src.length; i++) {
      if ("([{".includes(src[i])) depth++;
      else if (",".includes(src[i]) && depth === 1) {
        args.push(src.slice(from, i).replace(/\s+/g, " ").trim());
        from = i + 1;
      } else if (")]}".includes(src[i]) && --depth === 0) {
        args.push(src.slice(from, i).replace(/\s+/g, " ").trim());
        out.push({ start: m.index!, end: i + 1, args: args.filter((a) => a !== "") });
        break;
      }
    }
  }
  return out;
}

const IMPACT_FEEDBACK = [
  "playImpact",
  "shake",
  "burst",
  "setFlinchTier",
  "setFlinchTrigger",
  "celebrateFlush",
  "setFlightLanded(true)",
];

/**
 * Each impact-feedback call as `name: delay of the innermost timeout around it`,
 * or `name: no timeout`. `setFlightLanded(true)` outside a timeout is the early
 * end of a flight, not its landing, so only the timed ones are reported.
 */
function impactFeedbackTimers(src: string): string[] {
  const timers = calls(src, "setTimeout");
  const out: string[] = [];
  for (const name of IMPACT_FEEDBACK) {
    const callee = name.replace(/\(.*$/, "");
    for (const call of calls(src, callee)) {
      if (name.includes("(") && `${callee}(${call.args.join(", ")})` !== name) continue;
      const around = timers
        .filter((t) => t.start < call.start && call.end <= t.end)
        .sort((a, b) => b.start - a.start)[0];
      if (!around && name.includes("(")) continue;
      out.push(`${name}: ${around ? around.args.at(-1) : "no timeout"}`);
    }
  }
  return out;
}

/** Every timer — a `setTimeout` or a `withDelay` — whose delay is `FLIGHT_MS` and nothing else. */
const bareFlightTimers = (src: string): string[] => [
  ...calls(src, "setTimeout").map((c) => `setTimeout: ${c.args.at(-1)}`),
  ...calls(src, "withDelay").map((c) => `withDelay: ${c.args[0]}`),
].filter((t) => t.endsWith(": FLIGHT_MS"));


const combo = (ids: string[]): any => ({
  type: "single",
  strength: 1,
  cards: ids.map((id) => ({ id })),
});


/** Four seats, all still holding cards. */
const ALL_IN = [false, false, false, false];


describe("comboKey", () => {
  test("the same cards played by different seats are different plays", () => {
    assert.notEqual(comboKey(combo(["a", "b"]), 0), comboKey(combo(["a", "b"]), 1));
  });

  test("the same play produces a stable key", () => {
    assert.equal(comboKey(combo(["a", "b"]), 2), comboKey(combo(["a", "b"]), 2));
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
    // (GAME-RULES.md §11) while both opponents still hold cards.
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


describe("the timer scans", () => {
  test("the call reader takes a timer's delay from the call, never from a comment beside it", () => {
    const planted = blankCommentsAndStrings(
      [
        "// impactDelayMs(reduceMotion) + landingHoldMs(reduceMotion)",
        "settle.value = withDelay(",
        "  impactDelayMs(reduceMotion),",
        "  withSequence(withTiming(1, { duration: 2 }), withSpring(0, cfg, (f) => {})),",
        ");",
      ].join("\n")
    );
    assert.deepEqual(
      calls(planted, "withDelay").map((c) => c.args),
      [["impactDelayMs(reduceMotion)", "withSequence(withTiming(1, { duration: 2 }), withSpring(0, cfg, (f) => {}))"]]
    );
  });
});

describe("a landed combination wobbles for 400 ms, the mockup's landWobble", () => {
  test("at rest before contact and after the wobble, including the whole of reduced motion", () => {
    assert.deepEqual(landWobble(0), { scale: 1, rotate: 0 });
    const end = landWobble(1);
    assert.equal(end.scale, 1);
    assert.equal(Math.abs(end.rotate), 0);
    assert.equal(LAND_WOBBLE_MS, 400);
  });

  test("scale 1 + 0.035·sin(50.8t)·(1−k)³ and rotation 0.6°·sin(40.8t)·(1−k)², t = 0.4k s", () => {
    // k = 0.25: t = 0.1 s, sin(5.08) = −0.933189, sin(4.08) = −0.806618.
    const w = landWobble(0.25);
    assert.ok(Math.abs(w.scale - 0.986221) < 1e-5, `scale ${w.scale}`);
    assert.ok(Math.abs(w.rotate - -0.272233) < 1e-5, `rotate ${w.rotate}`);
    const peak = Math.max(...Array.from({ length: 401 }, (_, i) => landWobble(i / 400).scale));
    assert.ok(peak > 1.02 && peak < 1.035, `peak scale ${peak}`);
  });

  test("pile.tsx draws the flying group at the wobble's scale and rotation, past the tween's end", () => {
    const src = readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8");
    assert.ok(src.includes("(clock.elapsed.value - spec.end) / LAND_WOBBLE_MS"));
    assert.ok(src.includes("const { scale: s, rotate } = landWobble(k);"));
    assert.match(src, /transform: \[\{ scale: s \}, \{ rotate: `\$\{rotate\}deg` \}\]/);
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
  // hand (docs/GAME-RULES.md §9). The partita rung is a further fact about the
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
    assert.equal(traumaFor("ordinary", false, false), 0);
    assert.equal(traumaFor("straightFlush", false, false), 0);
    assert.equal(traumaFor("bomb", false, false), Trauma.bomb);
    assert.equal(traumaFor("mancheWon", false, false), Trauma.mancheWon);
    assert.equal(traumaFor("partitaWon", false, false), Trauma.partitaWon);
  });

  test("the bomb outranks the manche and the partita both — a later 'tidy-up' that sorts by event size must fail this", () => {
    const bomb = traumaFor("bomb", false, false);
    const manche = traumaFor("mancheWon", false, false);
    const partita = traumaFor("partitaWon", false, false);
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
  // at mount — so they
  // are pinned here, directly against the pure functions, the way #783 did.
  test("reduced motion produces no shake, at every tier, without a bespoke branch", () => {
    const tiers: ImpactTier[] = ["ordinary", "straightFlush", "bomb", "mancheWon", "partitaWon"];
    for (const tier of tiers) {
      assert.equal(traumaFor(tier, true, false), 0, `${tier} must carry no trauma under reduced motion`);
    }
  });

  test("reduced motion answers exactly 0, not merely a small number", () => {
    assert.ok(
      Object.is(traumaFor("partitaWon", true, false), 0),
      "a fix that shrinks trauma instead of zeroing it would still shake, just less"
    );
  });

  test("screen shake switched off answers exactly 0 at every tier, and on leaves the tier's trauma", () => {
    const tiers: ImpactTier[] = ["ordinary", "straightFlush", "bomb", "mancheWon", "partitaWon"];
    for (const tier of tiers) {
      assert.ok(Object.is(traumaFor(tier, false, true), 0), `${tier} must not shake with screen shake off`);
      assert.equal(traumaFor(tier, false, false), Trauma[tier as keyof typeof Trauma] ?? 0);
    }
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
  test("the flinch and the shake read the tier off the one landing signal — never a second derivation", () => {
    const read = (...at: string[]) => blankComments(readFileSync(path.join(repoRoot, "components", ...at), "utf8"));
    assert.match(read("table", "pile.tsx"), /useLandingReaction\(signal, \(l\) => \{[^}]*flinchFor\(l\.tier/);
    assert.match(read("useTableFeedback.ts"), /useLandingReaction\(landing, \(l\) => \{[\s\S]*?traumaFor\(l\.tier/);
  });

  test("no impact the table feels waits on a timer: each starts at the flight's contact", () => {
    const src = readPile();
    assert.deepEqual(impactFeedbackTimers(src), ["celebrateFlush: no timeout"]);
    assert.deepEqual(bareFlightTimers(src), []);
  });

  test("the impact reader sees feedback fired at the throw, and a landing timed by FLIGHT_MS", () => {
    const planted = blankCommentsAndStrings(
      [
        "playImpact(heavy, dir, n);",
        "impactTimerRef.current = setTimeout(() => {",
        "  shake(tier); burst(tier); setFlinchTier(tier); setFlinchTrigger((t) => t + 1);",
        "  if (x) celebrateFlush();",
        "}, impactDelayMs(reduceMotion));",
        "const clearLanding = () => setFlightLanded(true);",
        "setFlightLanded(false);",
        "landTimerRef.current = setTimeout(() => { setFlightLanded(true); }, FLIGHT_MS);",
      ].join("\n")
    );
    assert.deepEqual(impactFeedbackTimers(planted), [
      "playImpact: no timeout",
      "shake: impactDelayMs(reduceMotion)",
      "burst: impactDelayMs(reduceMotion)",
      "setFlinchTier: impactDelayMs(reduceMotion)",
      "setFlinchTrigger: impactDelayMs(reduceMotion)",
      "celebrateFlush: impactDelayMs(reduceMotion)",
      "setFlightLanded(true): FLIGHT_MS",
    ]);
    assert.deepEqual(bareFlightTimers(planted), ["setTimeout: FLIGHT_MS"]);
  });

  // A second blind critique defeated a source-scan version of this same check
  // (matching `translateY: PILE_PREV_Y + flinchY.value` as text anywhere in
  // the file) with a decoy function holding the same literal text elsewhere,
  // and separately by dropping the static `-7deg` resting rotate outright —
  // both passed every test here. A scan proves the text is present, not that
  // it is reachable from the rendered node; `tests/native/pileFlinch.test.tsx`
  // mounts `PileLayer`, fires a landing, and reads the beaten group's
  // actual transform, which is the only thing that can tell the two apart.

  // A blind critique caught this exact shape: every test above stayed green
  // while the flinch was rewired onto `current`, the landing combination,
  // instead of `prev`, the one it beat — the whole point of the ticket. A
  // string search for "flinchY" anywhere in the file cannot catch
  // that; only asking which role's pose carries it can.
  test("the flinch lands on the beaten group, never on the new one — the whole point of the ticket", () => {
    const src = blankComments(
      readFileSync(path.join(repoRoot, "components", "table", "pile.tsx"), "utf8")
    );
    const pose = src.match(/const pose = useAnimatedStyle\(\(\) => \{[\s\S]*?\n {2}\}\);/);
    assert.ok(pose, "expected the play group's own pose worklet");
    assert.match(src, /const beaten = role === "beaten"/, "expected the pose's beaten flag to read the play's role");
    assert.deepEqual(
      pose![0].split("\n").filter((l) => /flinchY/.test(l)).map((l) => l.trim().startsWith("if (beaten)")),
      [true],
      "the flinch must never reach the landing combination — displacing the beaten play is the whole point of #764"
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
      /flinchFor\(l\.tier, reduceMotion\) \* scale/,
      "the flinch's own trigger must multiply flinchFor's answer by the table's own scale"
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

  test("only the bomb rotates, peaking at 1.2° and out of phase with the translation", () => {
    const samples = Array.from({ length: 200 }, (_, i) => (i / 200) * DECAY_MS);
    const bombTurns = samples.map((ms) => bombShake(BASE_EDGE, ms).rotate);
    const peak = Math.max(...bombTurns.map(Math.abs));
    assert.ok(peak > 0 && peak <= 1.2, `the bomb's rotation peak was ${peak}°`);
    assert.equal(bombShake(BASE_EDGE, 0).rotate, 0, "the rotation is phase-shifted off the jolt at impact");
    const quarterCycle = DECAY_MS / 12;
    assert.ok(
      Math.abs(Math.abs(bombShake(BASE_EDGE, quarterCycle).rotate) - shakeMagnitude(Trauma.bomb, quarterCycle, DECAY_MS) * 1.2) < 1e-9,
      "a quarter cycle in, the rotation is the whole decayed magnitude times the 1.2° peak"
    );
    for (const tier of ALL_TIERS) {
      if (tier === "bomb") continue;
      for (const ms of samples) {
        assert.equal(Math.abs(shakeOffset(1, ms, DECAY_MS, 1, shakeAmplitudeFor(tier)).rotate), 0, `${tier} must not rotate`);
      }
    }
  });

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
      const untouched = shakeOffset(traumaFor(tier, false, false), 0, DECAY_MS, scale);
      const withThisTicketsHelper = shakeOffset(traumaFor(tier, false, false), 0, DECAY_MS, scale, shakeAmplitudeFor(tier));
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
    const trauma = traumaFor("bomb", true, false);
    const { x, y } = shakeOffset(trauma, 0, DECAY_MS, scale, shakeAmplitudeFor("bomb"));
    assert.equal(x, 0, "the boosted amplitude must not turn a leaked trauma into visible displacement");
    assert.equal(y, 0, "the boosted amplitude must not turn a leaked trauma into visible displacement");
  });
});


describe("flightOrigin", () => {
  // Deliberately asymmetric left/right pads, so a test that happens to pass
  // only because the table is centred cannot hide here.
  const base: TableGeometry = {
    scale: 1,
    windowWidth: 800,
    windowHeight: 600,
    tableLeft: 40,
    tableRight: 20,
    tableTop: 10,
    surplus: 0,
    handZoneH: 100,
  };
  const midTop = (scale = 1) => base.tableTop + topBandHeight(scale);
  const pileY = (scale = 1) => midTop(scale) + (base.windowHeight - midTop(scale) - base.handZoneH) / 2;

  test("bottom: the throw starts at the hand row's own vertical centre", () => {
    // handRowCenterY = windowHeight - handZoneH/2 = 600-50 = 550.
    assert.deepEqual(flightOrigin({ ...base, dir: "bottom" }), { dx: 0, dy: 550 - pileY() });
  });

  test("bottom: the pile's own centre, not a fixed constant, is what scale moves through", () => {
    assert.ok(pileY(2) > pileY(1), "a larger scale takes a taller top band");
    assert.equal(flightOrigin({ ...base, dir: "bottom", scale: 2 }).dy, 550 - pileY(2));
  });

  test("top: dx is 0 — the top seat and the pile share the same horizontal centre", () => {
    assert.equal(flightOrigin({ ...base, dir: "top" }).dx, 0);
  });

  test("top: the throw starts above the pile, at the ring's own line", () => {
    // seatLabelH(1) = 17 + gap 2 + pad 4 + CHIP_H(1)=23 = 46; ringCenterY = 10+46+33/2 = 72.5.
    assert.equal(flightOrigin({ ...base, dir: "top" }).dy, 72.5 - pileY());
  });

  test("the top band is the label, the ring, the gap and the fan at its drawn cap", () => {
    const fanH = seatFanArc(FAN_DRAWN_CARDS.top, BACK_SCALE).bounds.h;
    assert.equal(topBandHeight(1), seatLabelH(1) + SEAT_DISC + seatGap(1) + fanH);
  });

  test("left/right: the side ring centres in its fixed slot at the top of the band", () => {
    const fanW = seatFanArc(FAN_DRAWN_CARDS.left, BACK_SCALE).bounds.w;
    assert.equal(sideSlotHeight(1), Math.max(SEAT_DISC, fanW));
    const dy = midTop() + sideSlotHeight(1) / 2 - pileY();
    assert.ok(dy < 0, `a raised seat throws downward into the pile: ${dy}`);
    assert.equal(flightOrigin({ ...base, dir: "left" }).dy, dy);
    assert.equal(flightOrigin({ ...base, dir: "right" }).dy, dy);
  });

  test("the bands hold every fan they draw", () => {
    for (const scale of [0.6, 1, 1.4, 2.1]) {
      const backScale = scale * BACK_SCALE;
      const fixedTop = topBandHeight(scale) - seatLabelH(scale) - SEAT_DISC * scale - seatGap(scale);
      assert.ok(Math.abs(fixedTop - drawnFanBounds(scale).topH) < 1e-9, `scale ${scale}: the top band is not the cap's`);
      for (let n = 1; n <= FAN_DRAWN_CARDS.top; n++) {
        const h = seatFanArc(n, backScale).bounds.h;
        assert.ok(h <= fixedTop + 1e-9, `scale ${scale}: ${n} top backs stand ${h} in a band of ${fixedTop}`);
      }
      for (const side of ["left", "right"] as const) {
        for (let n = 1; n <= FAN_DRAWN_CARDS[side]; n++) {
          const w = seatFanArc(n, backScale).bounds.w;
          assert.ok(w <= sideSlotHeight(scale) + 1e-9, `scale ${scale}: ${n} ${side} backs span ${w} in a slot of ${sideSlotHeight(scale)}`);
        }
      }
    }
  });

  test("a seat's place is the table's geometry, its hand zone taken from the hand card", () => {
    const place: SeatPlace = { ...base, bottomPad: 8, handCardH: 90 };
    const g: TableGeometry = tableGeometry(place);
    assert.equal(g.handZoneH, HAND_ZONE_H(90, 8));
    for (const dir of ["top", "bottom", "left", "right"] as const) {
      assert.deepEqual(seatPoint(place, dir), flightOrigin({ ...g, dir }), dir);
    }
  });

  test("the anchors are window points", () => {
    const a = anchorPoints(base);
    // tableW = 800-40-20 = 740, so the pile and the top ring sit at x = 40+370 = 410.
    assert.deepEqual(a.bottom, { x: 410, y: 550 });
    assert.deepEqual(a.top, { x: 410, y: 72.5 });
    assert.deepEqual(a.pile, { x: 410, y: pileY() });
    assert.deepEqual(a.left, { x: 64.5, y: midTop() + sideSlotHeight(1) / 2 });
    assert.deepEqual(a.right, { x: 755.5, y: a.left.y });
    for (const dir of ["top", "bottom", "left", "right"] as const) {
      assert.deepEqual(flightOrigin({ ...base, dir }), { dx: a[dir].x - a.pile.x, dy: a[dir].y - a.pile.y }, dir);
    }
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
  // CARD_W/CARD_H scan in `tests/ui-rules/layoutConstantsPinned.test.ts`).
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

  // Each traded card drawn in exactly one place: the hand, its flier, or the hand again (#650).
  describe("readHandArrival", () => {
    const KEPT = { id: "9_clubs", suit: "clubs", rank: "9", isJoker: false } as const;
    const choosing = { ...announce, cardGiven: undefined };
    const at = (receive: LegStage, give: LegStage = "waiting") => ({ ...NO_STAGES, key: "k", receive, give });
    const read = (over: Partial<Parameters<typeof readHandArrival>[0]>) =>
      readHandArrival({ hand: [KEPT, RECEIVED] as Card[], trade: announce, stages: at("waiting"), viewerSeat: 1, ...over });

    test("nothing is held back outside an exchange", () => {
      assert.deepEqual(read({ trade: null }), { withheldIds: [] });
    });

    test("the winner's hand keeps the card the engine already gave it out of the row until it lands", () => {
      for (const s of ["waiting", "flying", "rest", "tuck"] as const) {
        assert.deepEqual(read({ trade: choosing, stages: at(s) }).withheldIds, [RECEIVED.id], s);
      }
      assert.equal(read({ trade: choosing, stages: at("rest") }).arrivingIndex, undefined, "the row parts only for the tuck");
    });

    test("the tuck parts the row at the card's own place, and the landing gives it back to glow", () => {
      const tuck = read({ trade: choosing, stages: at("tuck") });
      assert.equal(tuck.arrivingIndex, 1);
      assert.equal(tuck.descendingId, RECEIVED.id);
      const landed = read({ trade: choosing, stages: at("landed") });
      assert.deepEqual(landed.withheldIds, []);
      assert.equal(landed.receivedId, RECEIVED.id);
      assert.equal(tuck.receivedId, undefined, "no glow before it is in the hand");
    });

    test("a card the hand does not hold parts nothing", () => {
      assert.equal(read({ trade: choosing, hand: [KEPT] as Card[], stages: at("tuck") }).arrivingIndex, undefined);
    });

    test("the card the winner gives stays in its hand until its leg lifts out of it", () => {
      const moved = [KEPT, RECEIVED] as Card[];
      assert.deepEqual(read({ hand: moved, stages: at("landed", "waiting") }).lent, GIVEN);
      assert.equal(read({ hand: moved, stages: at("landed", "flying") }).lent, undefined);
      const held = [KEPT, RECEIVED, GIVEN] as Card[];
      assert.deepEqual(read({ hand: held, stages: at("landed", "flying") }).withheldIds, [GIVEN.id]);
    });

    test("the loser lends the taken card until it lifts, then waits for the give", () => {
      const loser = (hand: Card[], receive: LegStage, give: LegStage) =>
        read({ hand, viewerSeat: 3, stages: at(receive, give) });
      assert.deepEqual(loser([KEPT] as Card[], "waiting", "waiting").lent, RECEIVED);
      assert.equal(loser([KEPT] as Card[], "flying", "waiting").lent, undefined);
      const after = [KEPT, GIVEN] as Card[];
      assert.deepEqual(loser(after, "landed", "rest").withheldIds, [GIVEN.id]);
      assert.equal(loser(after, "landed", "tuck").arrivingIndex, 1);
      assert.equal(loser(after, "landed", "landed").receivedId, GIVEN.id);
    });

    test("a bystander and a spectator are left alone", () => {
      assert.deepEqual(read({ viewerSeat: 0, stages: at("tuck") }), { withheldIds: [] });
      assert.deepEqual(read({ viewerSeat: null, stages: at("tuck") }), { withheldIds: [] });
    });

    test("both Jokers leave the loser's hand only while they are in the air", () => {
      const jokers = { ...announce, bothJokersException: true };
      const hand = [KEPT, ...JOKERS] as Card[];
      const ids = (s: LegStage) => read({ trade: jokers, hand, viewerSeat: 3, stages: at(s) }).withheldIds;
      assert.deepEqual(ids("waiting"), []);
      assert.deepEqual(ids("rest"), JOKERS.map((c) => c.id));
      assert.deepEqual(ids("landed"), []);
    });
  });

  describe("readTradeSeats", () => {
    const at = (receive: LegStage, give: LegStage = "waiting") => ({ ...NO_STAGES, key: "k", receive, give });
    const seats = (trade: Parameters<typeof readTradeSeats>[0], receive: LegStage, give?: LegStage) => {
      const { lit, shift } = readTradeSeats(trade, at(receive, give));
      return { lit: [...lit].sort(), shift: Object.fromEntries(shift) };
    };

    test("the giver lights from its card's first frame, the receiver from the rest, both out at the landing", () => {
      const choosing = { ...announce, cardGiven: undefined };
      assert.deepEqual(seats(choosing, "waiting").lit, []);
      assert.deepEqual(seats(choosing, "flying").lit, [3]);
      assert.deepEqual(seats(choosing, "rest").lit, [1, 3]);
      assert.deepEqual(seats(choosing, "tuck").lit, [1, 3]);
      assert.deepEqual(seats(choosing, "landed").lit, []);
      assert.deepEqual(seats(announce, "landed", "flying").lit, [1]);
    });

    test("each count shows the card where it is drawn, not where the engine moved it", () => {
      const choosing = { ...announce, cardGiven: undefined };
      assert.deepEqual(seats(choosing, "waiting").shift, { 1: -1, 3: 1 });
      assert.deepEqual(seats(choosing, "flying").shift, { 1: -1 });
      assert.deepEqual(seats(announce, "landed", "waiting").shift, { 1: 1, 3: -1 });
      assert.deepEqual(seats(announce, "landed", "rest").shift, { 3: -1 });
      assert.deepEqual(seats(announce, "landed", "landed").shift, {});
    });

    test("both Jokers light the loser and leave its fan while they fly", () => {
      const jokers = { ...announce, bothJokersException: true };
      assert.deepEqual(seats(jokers, "rest"), { lit: [3], shift: { 3: -2 } });
      assert.deepEqual(seats(jokers, "landed"), { lit: [], shift: {} });
    });

    test("no trade marks nothing", () => {
      assert.deepEqual(seats(null, "rest"), { lit: [], shift: {} });
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
    readThrownPlay(readInput(players, playedBy, combo));
  const readInput = (players: Player[], playedBy: number, combo = PAIR) =>
    ({
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

  test("the sweep heads for the round winner's seat, its fan at rest", () => {
    const players = table(3);
    const { playedBy: _p, combo: _c, ...geometry } = readInput(players, 3);
    assert.notDeepEqual(seatPoint(geometry, "left"), seatPoint(geometry, "top"));
  });

  test("every throw lands on the pile's one centre, midway between the table's edges", () => {
    const [right, left] = [read(table(1), 1).pile, read(table(3), 3).pile];
    assert.deepEqual(right, left);
    assert.equal(right.x, 20 + (844 - 20 - 20) / 2);
    assert.ok(right.y > 12 && right.y < 390 - 90, `pile centre ${right.y} outside the band between the top seat and the hand`);
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

  const ringFromPile = (thrown: ReturnType<typeof read>, count: number) => {
    const fan = fanPoint({ dx: 0, dy: 0 }, thrown.dir as "top" | "left" | "right", 1, count);
    return { x: thrown.from[0]!.x - fan.x, y: thrown.from[0]!.y - fan.y };
  };
  const samePlace = (a: { x: number; y: number }, b: { x: number; y: number }, what: string) =>
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${what}: ${JSON.stringify(a)} is not ${JSON.stringify(b)}`);

  test("the top seat's ring does not move with that seat's own count", () => {
    const at = (count: number) => ringFromPile(read(table(2, count), 2), count);
    for (const count of [1, 2, 5, 13]) samePlace(at(count), at(0), `${count} cards`);
  });

  test("a side seat's ring does not move with that seat's own count", () => {
    for (const seat of [1, 3]) {
      const at = (count: number) => ringFromPile(read(table(seat, count), seat), count);
      for (const count of [1, 2, 4, 13]) samePlace(at(count), at(0), `seat ${seat}, ${count} cards`);
    }
  });

  test("the pile does not move with the top seat's count", () => {
    const pile = (topCards: number) => {
      const players = table(1);
      players[2] = seat("top", topCards);
      return read(players, 1).pile;
    };
    for (const count of [0, 1, 3, 13]) assert.deepEqual(pile(count), pile(7), `the top seat holding ${count}`);
  });

  test("each seat throws from its own side", () => {
    const players = table(1);
    const origins = [1, 2, 3].map((s) => ({
      dir: read(players, s).dir,
      dx: read(players, s).from[0]!.x,
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

describe("readExchangeLegs", () => {
  const card = (id: string) =>
    ({ id, suit: "clubs", rank: "5", isJoker: false }) as Card;
  const seat = (id: string, cards: number) =>
    ({
      id,
      name: id,
      type: "ai",
      hand: Array.from({ length: cards }, (_, i) => card(`${id}_${i}`)),
    }) as unknown as Player;

  /** Four seats, the viewer at 0: 1 is right, 2 is top, 3 is left. */
  const players = [seat("me", 5), seat("right", 6), seat("top", 7), seat("left", 8)];

  const trade = (winnerIdx: number, loserIdx: number, bothJokersException = false) => ({
    winnerName: "",
    loserName: "",
    winnerIdx,
    loserIdx,
    bothJokersException,
    cardReceived: card("taken"),
    cardGiven: card("given"),
  });
  const GEOMETRY = {
    viewerSeat: 0,
    scale: 1,
    windowWidth: 844,
    windowHeight: 390,
    tableLeft: 20,
    tableRight: 20,
    tableTop: 12,
    surplus: 0,
    bottomPad: 8,
    handCardH: 90,
  };
  const legs = (winnerIdx: number, loserIdx: number, table = players, origins?: Map<string, CardFrom>, jokers = false) =>
    readExchangeLegs(
      { ...GEOMETRY, trade: trade(winnerIdx, loserIdx, jokers), players: table, opponents: arrangeOpponents(table, 0) },
      origins
    );

  test("every leg rests face up on the pile's own centre, at a played card's size", () => {
    for (const [winner, loser] of [[0, 2], [1, 3], [2, 1], [3, 0]]) {
      const { receive, give } = legs(winner, loser);
      for (const leg of [receive, give]) {
        const p = legPose(LEG.rest, leg);
        assert.deepEqual({ x: p.x, y: p.y, scale: p.scale, face: p.face }, { x: 0, y: 0, scale: 1, face: true }, `${winner}>${loser}`);
      }
    }
  });

  test("both Jokers rest side by side on the pile and go back to the loser", () => {
    const { jokers } = legs(1, 3, players, undefined, true);
    assert.deepEqual(jokers.map((j) => j.rest.x), [-18, 18]);
    for (const j of jokers) assert.deepEqual(j.from, j.to, "they leave and return to the same fan");
  });

  test("the viewer's card leaves from, and never jumps off, its own place in the hand", () => {
    const own = new Map<string, CardFrom>([["taken", { x: -40, y: -6, rot: 4, scale: 1.1 }]]);
    const from = legs(2, 0, players, own).receive.from;
    const hand = seatPoint(GEOMETRY, "bottom");
    assert.deepEqual(from, { x: -40 + hand.dx, y: -6 + hand.dy, rot: 4, scale: 1.1 });
  });

  test("swapping who won swaps the two legs", () => {
    assert.deepEqual(legs(1, 3).receive, legs(3, 1).give);
  });

  test("the viewer's end is the hand, face up; an opponent's is its fan, a back", () => {
    const { receive } = legs(0, 2);
    assert.equal(receive.toFace, true);
    assert.equal(receive.fromFace, false);
  });

  test("a side seat's own hand places the card it trades", () => {
    const at = (leftCards: number) =>
      legs(3, 0, [seat("me", 5), seat("right", 6), seat("top", 7), seat("left", leftCards)]).receive.to;
    assert.notDeepEqual(at(1), at(13));
  });
});
