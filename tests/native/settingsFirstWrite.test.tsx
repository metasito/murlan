// tests/native/settingsFirstWrite.test.tsx — storage is not written until it
// has been read.
//
// The ordering is the whole claim, and it is invisible in the end state: the
// player's settings are in storage a moment later either way, so a test that
// only looks at the result passes on the defect. What is wrong is that the
// defaults are written *first*, and a process kill in that window — an OS
// memory reclaim, a force-quit — leaves them there. The read is held open
// here so that window can be inspected rather than raced.
import { test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// SettingsProvider reaches expo-audio through lib/sounds; the native module has
// no JS side in a test renderer.
jest.mock("expo-audio", () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));

import { SettingsProvider, useSettings } from "@/context/SettingsContext";

/** A stored install with the sound off — #414's case, and the one that hurts. */
const MUTED = JSON.stringify({ soundVolume: 0, soundVolumeRestore: 0.8, hapticsEnabled: false });

function Probe() {
  const { soundVolume, hapticsEnabled, setHapticsEnabled } = useSettings();
  return (
    <>
      <Text>{`sound:${soundVolume}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="toggle" onPress={() => setHapticsEnabled(!hapticsEnabled)}>
        <Text>toggle</Text>
      </Pressable>
    </>
  );
}

let releaseRead: (raw: string | null) => void;
let getItem: ReturnType<typeof jest.spyOn>;
let setItem: ReturnType<typeof jest.spyOn>;

/** Every value handed to `setItem`, oldest first. */
function writes(): Record<string, unknown>[] {
  return (setItem.mock.calls as unknown as [string, string][]).map(([, value]) => JSON.parse(value));
}

beforeEach(() => {
  getItem = jest
    .spyOn(AsyncStorage, "getItem")
    .mockReturnValue(new Promise<string | null>((resolve) => { releaseRead = resolve; }));
  setItem = jest.spyOn(AsyncStorage, "setItem").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * Releases the held read and settles what it starts. Two passes, because the
 * load resolves through a `.finally` — the state it sets and the flag that
 * releases the write land on different microtask ticks.
 */
async function settleRead(raw: string | null) {
  await act(async () => { releaseRead(raw); });
  await act(async () => {});
}

/** Mounts and settles the effects, leaving the read outstanding. */
async function mountWithReadPending() {
  const view = await render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>
  );
  await act(async () => {});
  return view;
}

test("nothing is written while the read is still outstanding", async () => {
  await mountWithReadPending();
  expect(getItem).toHaveBeenCalled();
  expect(writes()).toEqual([]);
});

test("a muted install is never written back as unmuted", async () => {
  // The floor for the test above, and #414's own callout: silently re-enabling
  // audio for the whole install base is the failure mode. A defaults-first
  // write says `soundVolume: 1` before the stored 0 is ever seen, so this
  // fails on the *first* element rather than the last.
  await mountWithReadPending();
  await settleRead(MUTED);

  await waitFor(() => expect(writes().length).toBeGreaterThan(0));
  for (const written of writes()) {
    expect(written.soundVolume).toBe(0);
  }
});

test("a first-run install with nothing stored still persists", async () => {
  // The other floor. A guard that waits for a *value* rather than for the read
  // to finish never releases on a fresh install, and settings stop persisting
  // entirely — a worse bug than the one being fixed, and a silent one.
  const view = await mountWithReadPending();
  await settleRead(null);

  fireEvent.press(view.getByRole("button", { name: "toggle" }));
  await waitFor(() => expect(writes().length).toBeGreaterThan(0));
  expect(writes().at(-1)!.hapticsEnabled).toBe(false);
});
