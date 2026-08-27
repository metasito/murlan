// tests/settingsContext.test.ts — volume is the only audio switch.
//
// `soundsEnabled` and `musicEnabled` are derived from their volumes rather than
// stored, so the settings menu can drop two toggles without losing a way to
// mute (#414). The rules that makes possible are here rather than in the
// provider, because every one of them is a pure function of the stored object
// and a provider would need a renderer to ask.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { migrateAudio, migrateLevel, withEnabled, withVolume } from "../lib/audioLevel.ts";

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

  // Silent on the old build too — `play()` already bailed at a master volume of
  // 0 — so this changes what the toggle reads, never what the player hears.
  test("a volume dragged to zero with the switch left on reads as muted", () => {
    assert.equal(migrateLevel({ enabled: true, volume: 0 }, SOUND).volume, 0);
  });

  test("a restore level written by this build is preferred over deriving one", () => {
    assert.deepEqual(migrateLevel({ volume: 0, restore: 0.9 }, SOUND), {
      volume: 0,
      restore: 0.9,
    });
  });

  // The second launch is the one that can go wrong: the first write has already
  // dropped `enabled`, so a volume of 0 is the only thing still saying "muted".
  // Coalescing it with `||` rather than `??` would un-mute every account here.
  test("still muted on the launch after `enabled` stopped being written", () => {
    const first = migrateLevel({ enabled: false, volume: 0.8 }, SOUND);
    const written = { volume: first.volume, restore: first.restore };
    assert.deepEqual(migrateLevel(written, SOUND), { volume: 0, restore: 0.8 });
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

// The mapping itself, not just the rule it applies. Every one of these would
// type-check if the two subsystems' keys were swapped, and would mis-migrate
// every account in silence.
describe("which stored key feeds which level", () => {
  test("sound and music are read from their own keys, not each other's", () => {
    assert.deepEqual(
      migrateAudio(
        { soundVolume: 0.7, soundVolumeRestore: 0.9, musicVolume: 0.2, musicVolumeRestore: 0.3 },
        SOUND,
        MUSIC
      ),
      { soundVolume: 0.7, soundVolumeRestore: 0.9, musicVolume: 0.2, musicVolumeRestore: 0.3 }
    );
  });

  test("each subsystem falls back to its own default, not the other's", () => {
    assert.deepEqual(migrateAudio({}, SOUND, MUSIC), {
      soundVolume: SOUND,
      soundVolumeRestore: SOUND,
      musicVolume: MUSIC,
      musicVolumeRestore: MUSIC,
    });
  });

  test("muting one subsystem on the old build leaves the other audible", () => {
    const out = migrateAudio({ soundsEnabled: false, soundVolume: 0.8, musicVolume: 0.4 }, SOUND, MUSIC);
    assert.equal(out.soundVolume, 0);
    assert.equal(out.musicVolume, 0.4, "music must not be muted by the sound switch");
  });
});
