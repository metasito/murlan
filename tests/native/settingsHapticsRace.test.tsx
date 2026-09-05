// tests/native/settingsHapticsRace.test.tsx — a preloaded haptics-off stays
// off through SettingsProvider's own mount.
//
// lib/haptics.ts reads the stored preference at module init, ahead of any
// provider, so a correctly-preloaded `false` must survive SettingsProvider
// mounting with its own unread `hapticsEnabled: true` default. The window is
// invisible at the end state (both reads land on the same stored value
// eventually) — what matters is that nothing observes `true` in between,
// which is why this asserts mid-mount, not just after everything settles.
import { test, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  // The default resolves lib/haptics.ts's own module-init preload, which
  // fires the moment this file's imports below are required — ahead of
  // anything a test body could set up.
  default: {
    getItem: jest.fn(async () => JSON.stringify({ hapticsEnabled: false })),
    setItem: jest.fn(async () => {}),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { hapticsEnabled } from '@/lib/haptics';
import { SettingsProvider } from '@/context/SettingsContext';

test("SettingsProvider mounting does not reopen a preloaded haptics-off window", async () => {
  // Flush the microtasks lib/haptics's module-init .then() resolves on.
  await new Promise((resolve) => setImmediate(resolve));
  expect(hapticsEnabled()).toBe(false);

  let releaseRead!: (raw: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
    () => new Promise((resolve) => { releaseRead = resolve; })
  );

  await render(
    <SettingsProvider>
      <></>
    </SettingsProvider>
  );

  // SettingsProvider's own read is still outstanding — this is the window
  // #920 names. A stray push of its unread `hapticsEnabled: true` default
  // fails right here.
  expect(hapticsEnabled()).toBe(false);

  await act(async () => { releaseRead(JSON.stringify({ hapticsEnabled: false })); });
  await act(async () => {});

  expect(hapticsEnabled()).toBe(false);
});
