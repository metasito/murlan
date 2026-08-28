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
  const { hapticsEnabled, setHapticsEnabled } = useSettings();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="toggle" onPress={() => setHapticsEnabled(!hapticsEnabled)}>
      <Text>toggle</Text>
    </Pressable>
  );
}

let releaseRead: (raw: string | null) => void;
let failRead: (reason: Error) => void;
let getItem: jest.SpiedFunction<typeof AsyncStorage.getItem>;
let setItem: jest.SpiedFunction<typeof AsyncStorage.setItem>;

/** Every value handed to `setItem`, oldest first. */
function writes(): Record<string, unknown>[] {
  return setItem.mock.calls.map(([, value]) => JSON.parse(value));
}

beforeEach(() => {
  getItem = jest
    .spyOn(AsyncStorage, "getItem")
    .mockReturnValue(new Promise<string | null>((resolve, reject) => {
      releaseRead = resolve;
      failRead = reject;
    }));
  setItem = jest.spyOn(AsyncStorage, "setItem").mockResolvedValue(undefined);
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

/** The same, for a read that never lands. */
async function settleFailedRead() {
  await act(async () => { failRead(new Error("storage unavailable")); });
  await act(async () => {});
}

/**
 * Presses the probe's toggle and waits for the write it should cause. Counted
 * from the writes already made, not from zero: the load itself writes once, so
 * a gate on "any write at all" is satisfied before the press happens.
 */
async function pressToggleAndWait(view: Awaited<ReturnType<typeof mountWithReadPending>>) {
  const before = writes().length;
  fireEvent.press(view.getByRole("button", { name: "toggle" }));
  await waitFor(() => expect(writes().length).toBeGreaterThan(before));
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
  await mountWithReadPending();
  await settleRead(MUTED);

  await waitFor(() => expect(writes().length).toBeGreaterThan(0));
  for (const written of writes()) {
    expect(written.soundVolume).toBe(0);
  }
});

// The two floors. A guard that waits for a stored *value* rather than for the
// read to finish never releases on either of these, and settings stop
// persisting for the session — worse than what is being fixed, and silent.
test("a first-run install with nothing stored still persists", async () => {
  const view = await mountWithReadPending();
  await settleRead(null);

  await pressToggleAndWait(view);
  expect(writes().at(-1)!.hapticsEnabled).toBe(false);
});

test("a read that fails still leaves settings persisting", async () => {
  const view = await mountWithReadPending();
  await settleFailedRead();

  await pressToggleAndWait(view);
  expect(writes().at(-1)!.hapticsEnabled).toBe(false);
});
