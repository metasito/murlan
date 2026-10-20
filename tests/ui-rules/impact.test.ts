// What a landing earns: its tier, the shake, the flinch, the flare and the wobble.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Trauma, Motion, Spacing } from "../../lib/tokens.ts";
import {
  landWobble,
  LAND_WOBBLE_MS,
  comboImpactTier,
  landingTier,
  traumaFor,
  flinchFor,
  shakeMagnitude,
  shakeOffset,
  shakeAmplitudeFor,
  flareKindFor,
  type ImpactTier,
  type FlareKind,
} from "../../components/impact.ts";
import { blankComments, blankCommentsAndStrings } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  "celebrateGoingOut",
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
    assert.ok(src.includes("landWobble(still ? 0 : Math.min(1, Math.max(0, (elapsed - end) / LAND_WOBBLE_MS)))"));
    assert.ok(src.includes("const w = wobbleAt(clock.elapsed.value, spec.end, still);"));
    assert.match(src, /transform: \[\{ scale: w\.scale \}, \{ rotate: `\$\{w\.rot\}deg` \}\]/);
  });
});


describe("the table's own trauma escalation (#763)", () => {
  const DECAY_MS = Motion.duration.shake;

  test("a play's tier reads off the combination that just landed", () => {
    assert.equal(comboImpactTier("bomb"), "bomb");
    assert.equal(comboImpactTier("straight"), "straight");
    assert.equal(comboImpactTier("royal_straight"), "straight");
    assert.equal(comboImpactTier("single"), "ordinary");
    assert.equal(comboImpactTier("pair"), "ordinary");
    assert.equal(comboImpactTier("triple"), "ordinary");
  });

  // The round rung is `GameState.roundOver` (processPlay: "the round is
  // decided"), never `trickWinner` — that is a trick, closing many times a
  // round (docs/GAME-RULES.md §9). The match rung is a further fact about the
  // same landing (`MatchVerdict.over`), not a second, later event.
  describe("landingTier", () => {
    test("a play that closes nothing lands at its own tier", () => {
      assert.equal(landingTier({ comboType: "single", roundOver: false, matchOver: false, viewerWon: false }), "ordinary");
      assert.equal(landingTier({ comboType: "bomb", roundOver: false, matchOver: false, viewerWon: false }), "bomb");
    });

    test("the round emptying, with the match still open, is the round rung for the viewer who won it", () => {
      assert.equal(landingTier({ comboType: "single", roundOver: true, matchOver: false, viewerWon: true }), "roundWon");
    });

    test("a round the viewer did not win lands at the play's own tier: no shake for lost, neutral or draw (#1469)", () => {
      assert.equal(landingTier({ comboType: "single", roundOver: true, matchOver: false, viewerWon: false }), "ordinary");
      assert.equal(landingTier({ comboType: "bomb", roundOver: true, matchOver: false, viewerWon: false }), "bomb");
    });

    test("the round emptying and the match closing with it is the match rung for the viewer who won the match", () => {
      assert.equal(landingTier({ comboType: "single", roundOver: true, matchOver: true, viewerWon: true }), "matchWon");
    });

    test("a match the viewer lost lands at the play's own tier: no shake (#1423)", () => {
      assert.equal(landingTier({ comboType: "single", roundOver: true, matchOver: true, viewerWon: false }), "ordinary");
      assert.equal(landingTier({ comboType: "bomb", roundOver: true, matchOver: true, viewerWon: false }), "bomb");
    });

    test("matchOver with roundOver false never fires the match rung — a match cannot close on a round still in play", () => {
      assert.equal(landingTier({ comboType: "single", roundOver: false, matchOver: true, viewerWon: true }), "ordinary");
    });

    test("a bomb that also closes the round is only as loud as its loudest rung", () => {
      assert.equal(landingTier({ comboType: "bomb", roundOver: true, matchOver: false, viewerWon: true }), "bomb");
      assert.equal(landingTier({ comboType: "bomb", roundOver: true, matchOver: true, viewerWon: true }), "bomb");
    });
  });

  test("the tier→trauma mapping is the one table #101 settled", () => {
    assert.equal(traumaFor("ordinary", false, false), 0);
    assert.equal(traumaFor("straight", false, false), 0);
    assert.equal(traumaFor("bomb", false, false), Trauma.bomb);
    assert.equal(traumaFor("roundWon", false, false), Trauma.roundWon);
    assert.equal(traumaFor("matchWon", false, false), Trauma.matchWon);
  });

  test("the bomb outranks the round and the match both — a later 'tidy-up' that sorts by event size must fail this", () => {
    const bomb = traumaFor("bomb", false, false);
    const round = traumaFor("roundWon", false, false);
    const match = traumaFor("matchWon", false, false);
    assert.ok(
      bomb > round,
      "a bomb is a surprise and a round ending is expected — the bomb shakes harder on purpose"
    );
    assert.ok(bomb > match, "the bomb outranks even the match: it is the surprise in the game");
    assert.ok(match > round, "a match closing still outshakes a round closing");
  });

  // The four probes a blind critique ran against the shipped shake: the
  // reduced-motion zeroing removed outright, applied to only some tiers (one
  // escaping), and answering a small non-zero number instead of true rest.
  // `tests/native/tableShake.test.tsx` cannot red on these — a
  // `useAnimatedStyle` read off a mounted node is frozen at whatever it was
  // at mount — so they
  // are pinned here, directly against the pure functions, the way #783 did.
  test("reduced motion produces no shake, at every tier, without a bespoke branch", () => {
    const tiers: ImpactTier[] = ["ordinary", "straight", "bomb", "roundWon", "matchWon"];
    for (const tier of tiers) {
      assert.equal(traumaFor(tier, true, false), 0, `${tier} must carry no trauma under reduced motion`);
    }
  });

  test("reduced motion answers exactly 0, not merely a small number", () => {
    assert.ok(
      Object.is(traumaFor("matchWon", true, false), 0),
      "a fix that shrinks trauma instead of zeroing it would still shake, just less"
    );
  });

  test("screen shake switched off answers exactly 0 at every tier, and on leaves the tier's trauma", () => {
    const tiers: ImpactTier[] = ["ordinary", "straight", "bomb", "roundWon", "matchWon"];
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

  test("the tiers separate quadratically, not linearly — a bomb stands further above a round than the raw trauma table shows", () => {
    const bomb = shakeMagnitude(Trauma.bomb, 0, DECAY_MS);
    const round = shakeMagnitude(Trauma.roundWon, 0, DECAY_MS);
    const rawRatio = Trauma.bomb / Trauma.roundWon;
    const squaredRatio = bomb / round;
    assert.ok(
      squaredRatio > rawRatio + 1e-9,
      `squaring trauma must widen the bomb-over-round gap past its raw ${rawRatio}, got ${squaredRatio}`
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
      readFileSync(path.join(repoRoot, "components", "impact.ts"), "utf8")
    );
    assert.doesNotMatch(
      src,
      /const (BOMB_)?SHAKE_AMPLITUDE_[XY]\s*=\s*\d/,
      "a shake amplitude must read a Spacing step, not a pixel literal"
    );
  });
});

describe("the beaten pile's flinch (#764)", () => {
  const ALL_TIERS: ImpactTier[] = ["ordinary", "straight", "bomb", "roundWon", "matchWon"];

  test("the tier→displacement mapping reads the same five tiers #763's trauma table does", () => {
    assert.equal(flinchFor("ordinary", false), 0);
    assert.equal(flinchFor("straight", false), Spacing.xxs);
    assert.equal(flinchFor("bomb", false), Spacing.slim);
    assert.equal(flinchFor("roundWon", false), Spacing.slim);
    assert.equal(flinchFor("matchWon", false), Spacing.slim);
  });

  test("a straight or royal straight still displaces what it beat — only the ordinary win is silent", () => {
    assert.ok(
      flinchFor("straight", false) > flinchFor("ordinary", false),
      "the land spring's own overshoot is the whole effect for an ordinary win, but a straight or royal straight must visibly give ground"
    );
  });

  test("bomb, round and match all knock the beaten pile the same distance — the escalation past the bomb rides the shake and the hold, not a bigger knock", () => {
    assert.equal(flinchFor("bomb", false), flinchFor("roundWon", false));
    assert.equal(flinchFor("roundWon", false), flinchFor("matchWon", false));
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
      readFileSync(path.join(repoRoot, "components", "impact.ts"), "utf8")
    );
    const table = src.match(/const FLINCH_BY_TIER: Record<ImpactTier, number> = \{[\s\S]*?\};/);
    assert.ok(table, "expected a FLINCH_BY_TIER table in impact.ts");
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
    assert.deepEqual(impactFeedbackTimers(src), ["celebrateGoingOut: no timeout"]);
    assert.deepEqual(bareFlightTimers(src), []);
  });

  test("the impact reader sees feedback fired at the throw, and a landing timed by FLIGHT_MS", () => {
    const planted = blankCommentsAndStrings(
      [
        "playImpact(heavy, dir, n);",
        "impactTimerRef.current = setTimeout(() => {",
        "  shake(tier); burst(tier); setFlinchTier(tier); setFlinchTrigger((t) => t + 1);",
        "  if (x) celebrateGoingOut();",
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
      "celebrateGoingOut: impactDelayMs(reduceMotion)",
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
    const helper = src.match(/function groupPose\([\s\S]*?\n\}/);
    assert.ok(helper, "expected the one group pose both the style and the card's rectangle read");
    assert.match(src, /const beaten = role === "beaten"/, "expected the pose's beaten flag to read the play's role");
    assert.match(src, /const group = useMemo\(\(\) => \(\{[^}]*\bbeaten, /, "the pose's `beaten` is that flag, not a literal");
    assert.deepEqual(
      helper![0].split("\n").filter((l) => /flinchY/.test(l)).map((l) => /\bg\.beaten && g\.flinchBy\.value !== g\.key \? g\.flinchY\.value : 0\b/.test(l)),
      [true],
      "the flinch must never reach the landing combination — displacing the beaten play is the whole point of #764"
    );
    const reads = src.split("\n").filter((l) => /flinchY\.value|groupPose\(/.test(l) && !/function groupPose/.test(l));
    assert.equal(reads.length, 3, "the helper's gate, the group's style and the card's rectangle");
    assert.equal(reads.filter((l) => /groupPose\(group, turned\.value\)/.test(l)).length, 2, "both read the pose through the helper, never a copy of the gate");
    assert.match(src, /catchLift\(catching\?\.value \?\? 0, cardScale\)/);
    assert.match(src, /liftY: catchLift\(c, cardScale\)/);
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

describe("the lamp's flare (#765)", () => {
  const ALL_TIERS: ImpactTier[] = ["ordinary", "straight", "bomb", "roundWon", "matchWon"];

  test("the graduated table #101 settled: only the bomb and the match flare", () => {
    const expected: Record<ImpactTier, FlareKind> = {
      ordinary: "none",
      straight: "none",
      bomb: "brief",
      roundWon: "none",
      matchWon: "settle",
    };
    for (const tier of ALL_TIERS) {
      assert.equal(flareKindFor(tier), expected[tier], `${tier} flare kind`);
    }
  });

  test("a straight or royal straight lands at its own tier and gets no flare", () => {
    // The rung this ticket's own tier table names "Ordinary win, straight /
    // flush" — the row `comboImpactTier` calls "straight", never a bomb.
    assert.equal(flareKindFor("straight"), "none");
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

  const ALL_TIERS: ImpactTier[] = ["ordinary", "straight", "bomb", "roundWon", "matchWon"];

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
    const shared = shakeAmplitudeFor("roundWon");
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

  test("a round or match closed by an ordinary combination — no kick to lean on — keeps exactly the shake it had before this ticket", () => {
    for (const tier of ["roundWon", "matchWon"] as const) {
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

