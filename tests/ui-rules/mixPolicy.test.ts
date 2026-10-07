import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LANDING_PULSES, MOMENTS, cueFor, isCombo, landingPulsesFor, mix, type Moment, type MomentKind } from "../../lib/device/moments.ts";

const KINDS: MomentKind[] = [
  "landing", "mancheOver", "partitaOver", "roundWon", "roundStart", "select", "deselect",
  "reject", "give", "pass", "deal", "exchange", "turn", "clockRunningOut", "reconnected",
];
const tapAt = (tap: string, atMs = 0) => ({ tap, atMs });
const sound = (batch: Moment[], t = 0, played: ReturnType<typeof mix>["played"] = []) => mix(batch, t, played).sound?.id ?? null;
const land = (cards: number, bomb: boolean, mine: boolean): Moment => ({ kind: "landing", cards, bomb, mine });

describe("every moment maps", () => {
  test("MOMENTS holds exactly the design's moments", () => {
    assert.deepEqual(Object.keys(MOMENTS).sort(), [...KINDS].sort());
  });

  test("your single card lands light, any combo of yours medium, with the matching sound and no haptic in the cue", () => {
    assert.deepEqual(cueFor(land(1, false, true)), { sound: "play", bus: "sfx", haptics: [] });
    for (const cards of [2, 3, 5]) {
      assert.deepEqual(cueFor(land(cards, false, true)), { sound: "combo", bus: "sfx", haptics: [] });
    }
    assert.deepEqual(LANDING_PULSES.play, [{ strength: "light", offsetMs: 0 }]);
    assert.deepEqual(LANDING_PULSES.combo, [{ strength: "medium", offsetMs: 0 }]);
  });

  test("someone else's cards land silent in the hand", () => {
    assert.deepEqual(cueFor(land(1, false, false)).haptics, []);
    assert.deepEqual(landingPulsesFor({ cards: 4, bomb: false, mine: false }), []);
    assert.equal(cueFor(land(4, false, false)).sound, "combo");
  });

  test("the sound and the pulse split on the same n > 1 predicate", () => {
    for (const cards of [1, 2, 3, 4, 5]) {
      assert.equal(cueFor(land(cards, false, true)).sound === "combo", isCombo(cards));
      assert.equal(landingPulsesFor({ cards, bomb: false, mine: true })[0].strength === "medium", isCombo(cards));
    }
  });

  test("a bomb from any seat is a sting, rigid on impact, heavy at 256 ms, light at 416 ms", () => {
    for (const mine of [true, false]) {
      assert.deepEqual(cueFor(land(4, true, mine)), { sound: "bomb", bus: "sting", haptics: [] });
      assert.deepEqual(landingPulsesFor({ cards: 4, bomb: true, mine }), [
        { strength: "rigid", offsetMs: 0 },
        { strength: "heavy", offsetMs: 256 },
        { strength: "light", offsetMs: 416 },
      ]);
    }
  });

  test("a manche ends on a notification haptic with its sting; a draw has its own soft one (D6)", () => {
    assert.deepEqual(cueFor({ kind: "mancheOver", outcome: "won" }), { sound: "mancheWon", bus: "sting", haptics: [tapAt("success")] });
    assert.deepEqual(cueFor({ kind: "mancheOver", outcome: "lost" }), { sound: "mancheLost", bus: "sting", haptics: [tapAt("warn")] });
    assert.deepEqual(cueFor({ kind: "mancheOver", outcome: "neutral" }), { sound: "mancheNeutral", bus: "sting", haptics: [] });
  });

  test("a partita's haptic opens 300 ms ahead of its sting", () => {
    assert.deepEqual(cueFor({ kind: "partitaOver", won: true }), {
      sound: "partitaWon", bus: "sting", haptics: [tapAt("medium", -300), tapAt("success")],
    });
    assert.deepEqual(cueFor({ kind: "partitaOver", won: false }).haptics, [tapAt("medium", -300), tapAt("warn")]);
  });

  test("the hand's own taps, the turn, and the sound-only moments", () => {
    assert.deepEqual(cueFor({ kind: "select" }), { sound: "select", bus: "sfx", haptics: [tapAt("selection")] });
    assert.deepEqual(cueFor({ kind: "deselect" }), { sound: "deselect", bus: "sfx", haptics: [tapAt("selection")] });
    assert.deepEqual(cueFor({ kind: "reject" }), { sound: "reject", bus: "sfx", haptics: [tapAt("rigid")] });
    assert.deepEqual(cueFor({ kind: "give" }), { sound: "play", bus: "sfx", haptics: [tapAt("medium")] });
    assert.deepEqual(cueFor({ kind: "turn" }), { sound: "turn", bus: "sfx", haptics: [tapAt("light")] });
    const soundOnly = { pass: "pass", deal: "deal", exchange: "exchange", clockRunningOut: "clockRunningOut", roundWon: "round_win", roundStart: "round_start", reconnected: "reconnected" } as const;
    for (const [kind, id] of Object.entries(soundOnly)) {
      assert.deepEqual(cueFor({ kind } as Moment), { sound: id, bus: "sfx", haptics: [] });
    }
  });
});

describe("one event sounds one thing", () => {
  test("the research's pile-ups, each as one event", () => {
    assert.equal(sound([{ kind: "turn" }, { kind: "pass" }]), "pass");
    assert.equal(sound([{ kind: "pass" }, { kind: "roundWon" }]), "round_win");
    assert.equal(sound([land(1, false, false), { kind: "turn" }]), "play");
  });

  test("a turn 34 ms after the landing that handed it over stays silent", () => {
    const first = mix([land(1, false, false)], 1000, []);
    assert.equal(sound([{ kind: "turn" }], 1034, first.played), null);
  });

  test("a turn well clear of the landing still sounds", () => {
    const first = mix([land(1, false, false)], 1000, []);
    assert.equal(sound([{ kind: "turn" }], 1500, first.played), "turn");
  });

  test("a deal withdraws a turn still waiting 35 ms ahead of it, and yields to one already sounding", () => {
    const waiting = mix([{ kind: "turn" }], 634.5, [], 412);
    const dealt = mix([{ kind: "deal" }], 600, waiting.played, 600);
    assert.equal(dealt.sound?.id, "deal");
    assert.deepEqual(dealt.withdrawn, ["turn"]);
    assert.deepEqual(dealt.played.map((p) => p.id), ["deal"]);
    const sounding = mix([{ kind: "turn" }], 590.5, [], 368);
    assert.equal(mix([{ kind: "deal" }], 600, sounding.played, 600).sound, null);
  });

  test("a landing 50 ms after a select still sounds", () => {
    const tapped = mix([{ kind: "select" }], 1000, []);
    assert.equal(sound([land(1, false, false)], 1050, tapped.played), "play");
  });

  test("a select 30 ms after a landing still sounds", () => {
    const first = mix([land(2, false, false)], 1000, []);
    assert.equal(sound([{ kind: "select" }], 1030, first.played), "select");
  });

  test("the haptic comes from the highest moment that has one, even when a higher one is silent to the hand", () => {
    const out = mix([{ kind: "pass" }, { kind: "roundWon" }, { kind: "turn" }], 0, []);
    assert.equal(out.sound?.id, "round_win");
    assert.deepEqual(out.haptics, [tapAt("light")]);
  });

  test("a landing that pulses silences a coincident turn tap; one that does not, does not", () => {
    assert.deepEqual(mix([land(1, false, true), { kind: "turn" }], 0, []).haptics, []);
    assert.deepEqual(mix([land(4, true, false), { kind: "turn" }], 0, []).haptics, []);
    assert.deepEqual(mix([land(1, false, false), { kind: "turn" }], 0, []).haptics, [tapAt("light")]);
  });
});
