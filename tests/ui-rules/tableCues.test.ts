// The sound and the haptic each table moment gets, pinned row by row against #1249's table.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cueFor, isCombo, type Cue } from "../../lib/device/cues.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));

const at = (helper: Cue["haptics"][number]["helper"], atMs: number) => ({ helper, atMs });

describe("table cues", () => {
  test("your single card lands with a light tap", () => {
    assert.deepEqual(cueFor({ kind: "landing", cards: 1, bomb: false, mine: true }), {
      sound: "play",
      haptics: [at("hapticLight", 0)],
    });
  });

  test("your combo lands with a medium tap, whatever its shape", () => {
    for (const cards of [2, 3, 5]) {
      assert.deepEqual(cueFor({ kind: "landing", cards, bomb: false, mine: true }), {
        sound: "combo",
        haptics: [at("hapticMedium", 0)],
      });
    }
  });

  test("someone else's cards land silent in the hand", () => {
    assert.deepEqual(cueFor({ kind: "landing", cards: 1, bomb: false, mine: false }), {
      sound: "play",
      haptics: [],
    });
    assert.deepEqual(cueFor({ kind: "landing", cards: 4, bomb: false, mine: false }), {
      sound: "combo",
      haptics: [],
    });
  });

  test("the sound and the haptic split on the same n > 1 predicate", () => {
    for (const cards of [1, 2, 3, 4, 5]) {
      const cue = cueFor({ kind: "landing", cards, bomb: false, mine: true });
      assert.equal(cue.sound === "combo", isCombo(cards), `sound at n=${cards}`);
      assert.equal(cue.haptics[0].helper === "hapticMedium", isCombo(cards), `haptic at n=${cards}`);
    }
    assert.equal(isCombo(1), false);
    assert.equal(isCombo(2), true);
  });

  test("a bomb from any seat: rigid on the sound, heavy on the first jolt, light on the second", () => {
    const pulses = [at("hapticRigid", 0), at("hapticHeavy", 256), at("hapticLight", 416)];
    for (const mine of [true, false]) {
      assert.deepEqual(cueFor({ kind: "landing", cards: 4, bomb: true, mine }), { sound: "bomb", haptics: pulses });
    }
  });

  test("the turn passing to you taps once", () => {
    assert.deepEqual(cueFor({ kind: "turn" }), { sound: "turn", haptics: [at("hapticLight", 0)] });
  });

  test("a manche ends on a notification haptic with its sound", () => {
    assert.deepEqual(cueFor({ kind: "mancheOver", won: true }), {
      sound: "mancheWon",
      haptics: [at("hapticSuccess", 0)],
    });
    assert.deepEqual(cueFor({ kind: "mancheOver", won: false }), {
      sound: "mancheLost",
      haptics: [at("hapticWarn", 0)],
    });
  });

  test("a partita's haptic opens 300 ms ahead of its sound", () => {
    assert.deepEqual(cueFor({ kind: "partitaOver", won: true }), {
      sound: "partitaWon",
      haptics: [at("hapticMedium", -300), at("hapticSuccess", 0)],
    });
    assert.deepEqual(cueFor({ kind: "partitaOver", won: false }), {
      sound: "partitaLost",
      haptics: [at("hapticMedium", -300), at("hapticWarn", 0)],
    });
  });

  test("pass, deal, exchange, the clock and a reconnect are sound only", () => {
    const soundOnly = {
      pass: "pass",
      deal: "deal",
      exchange: "exchange",
      clockRunningOut: "clockRunningOut",
      reconnected: "reconnected",
    } as const;
    for (const [kind, sound] of Object.entries(soundOnly)) {
      assert.deepEqual(cueFor({ kind: kind as keyof typeof soundOnly }), { sound, haptics: [] });
    }
  });

  test("the hand's own taps keep their haptics", () => {
    assert.deepEqual(cueFor({ kind: "select" }), { sound: "select", haptics: [at("hapticSelection", 0)] });
    assert.deepEqual(cueFor({ kind: "deselect" }), { sound: "deselect", haptics: [at("hapticSelection", 0)] });
    assert.deepEqual(cueFor({ kind: "reject" }), { sound: "reject", haptics: [at("hapticRigid", 0)] });
    assert.deepEqual(cueFor({ kind: "give" }), { sound: "play", haptics: [at("hapticMedium", 0)] });
  });

  test("no screen plays a cue's sound except through playCue", () => {
    const cueSounds = [
      ...readFileSync(path.join(root, "lib/device/playCue.ts"), "utf8").matchAll(/sounds\.(play\w+)\(\)/g),
    ].map((m) => m[1]);
    assert.ok(cueSounds.length >= 16, `found ${cueSounds.length} cue sounds in playCue.ts — the scan is broken`);
    const direct = new RegExp(`\\b(${cueSounds.join("|")})\\b`);
    const offenders = ["app", "components", "context"]
      .flatMap(sourceFiles)
      .filter((file) => direct.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    assert.deepEqual(offenders, []);
  });
});
