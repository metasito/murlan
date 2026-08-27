// tests/settingsContext.test.ts — volume is the only audio switch.
//
// `soundsEnabled` and `musicEnabled` are derived from their volumes rather than
// stored, so the settings menu can drop two toggles without losing a way to
// mute (#414). The rules that makes possible are here rather than in the
// provider, because every one of them is a pure function of the stored object
// and a provider would need a renderer to ask.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { migrateLevel, withEnabled, withVolume } from "../lib/audioLevel.ts";

const SOUND = 1;
const MUSIC = 0.5;

describe("setting a volume", () => {
  test("a non-zero level becomes the level unmuting returns to", () => {
    assert.deepEqual(withVolume({ volume: 1, restore: 1 }, 0.3), { volume: 0.3, restore: 0.3 });
  });

  test("dragging to zero mutes but keeps the level to come back to", () => {
    assert.deepEqual(withVolume({ volume: 0.3, restore: 0.3 }, 0), { volume: 0, restore: 0.3 });
  });

  test("out-of-range input is clamped, not stored raw", () => {
    assert.deepEqual(withVolume({ volume: 0.5, restore: 0.5 }, 4), { volume: 1, restore: 1 });
    assert.deepEqual(withVolume({ volume: 0.5, restore: 0.5 }, -2), { volume: 0, restore: 0.5 });
  });
});

describe("the mute/unmute round trip", () => {
  test("off then on returns the exact previous level", () => {
    const start = withVolume({ volume: SOUND, restore: SOUND }, 0.42);
    const muted = withEnabled(start, false, SOUND);
    assert.equal(muted.volume, 0, "muting is volume zero");
    assert.equal(withEnabled(muted, true, SOUND).volume, 0.42);
  });

  test("muting twice does not lose the level", () => {
    const muted = withEnabled(withEnabled(withVolume({ volume: 1, restore: 1 }, 0.2), false, SOUND), false, SOUND);
    assert.equal(withEnabled(muted, true, SOUND).volume, 0.2);
  });

  // A cold start reads the stored object; nothing is in memory to fall back on,
  // which is the case the restore level exists for.
  test("unmuting after a restart returns the stored level, not full volume", () => {
    const stored = migrateLevel({ volume: 0, restore: 0.2 }, MUSIC);
    assert.equal(withEnabled(stored, true, MUSIC).volume, 0.2);
  });

  test("unmuting with no level to return to falls back to the default", () => {
    assert.equal(withEnabled({ volume: 0, restore: 0 }, true, MUSIC).volume, MUSIC);
  });
});

describe("settings written before volume became the switch", () => {
  // The failure mode this guards: silently re-enabling audio for every account
  // that had it off.
  test("a stored `enabled: false` stays silent, and keeps its level to return to", () => {
    const level = migrateLevel({ enabled: false, volume: 0.8 }, SOUND);
    assert.equal(level.volume, 0, "a player who had sound off still has it off");
    assert.equal(level.restore, 0.8, "and unmuting returns to what they had chosen");
  });

  test("a stored `enabled: true` keeps its volume", () => {
    assert.deepEqual(migrateLevel({ enabled: true, volume: 0.3 }, SOUND), {
      volume: 0.3,
      restore: 0.3,
    });
  });

  test("`enabled: false` with no usable volume falls back to the default", () => {
    assert.deepEqual(migrateLevel({ enabled: false, volume: 0 }, MUSIC), {
      volume: 0,
      restore: MUSIC,
    });
  });

  test("nothing stored at all is the default, unmuted", () => {
    assert.deepEqual(migrateLevel({}, MUSIC), { volume: MUSIC, restore: MUSIC });
  });

  test("a restore level written by this build is preferred over deriving one", () => {
    assert.deepEqual(migrateLevel({ volume: 0, restore: 0.9 }, SOUND), {
      volume: 0,
      restore: 0.9,
    });
  });

  test("a junk stored value does not mute the game or poison the restore", () => {
    assert.deepEqual(migrateLevel({ volume: "loud", restore: null }, SOUND), {
      volume: SOUND,
      restore: SOUND,
    });
    assert.deepEqual(migrateLevel({ volume: Number.NaN }, MUSIC), {
      volume: MUSIC,
      restore: MUSIC,
    });
  });
});
