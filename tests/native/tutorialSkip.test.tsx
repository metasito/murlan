// tests/native/tutorialSkip.test.tsx — Skip leaves the tutorial.
//
// #619: on Android the control is tapped successfully and the screen does not
// change. Maestro reports the tap COMPLETED, the hierarchy has the node
// clickable and enabled at the coordinates it hit, and 12k lines of logcat
// carry no exception — so what has to be established first is whether the
// press reaches `router.replace` at all. Everything between the press and that
// call is `await`ed, and an await that never settles looks exactly like this.
//
// The signed-out case is the one the device flows run (`clearState: true`), and
// the signed-in case is the one that reaches the network.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

let mockAuthUser: { id: string; username: string; tutorialSeenAt: string | null } | null = null;
let mockAuthLoading = false;
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuthUser, loading: mockAuthLoading }),
}));

// Resolved by the test, not by the factory: a request that never settles is
// one of the two things this file exists to tell apart.
let apiSettles: () => void = () => {};
let apiCalls = 0;
jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(
    () =>
      new Promise((resolve) => {
        apiCalls += 1;
        apiSettles = () => resolve({ json: async () => ({}) });
      })
  ),
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { router } from 'expo-router';
import TutorialScreen from '@/app/tutorial';
import { t } from '@/lib/i18n';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

/** Mounts the tutorial and waits out the stored-progress read it renders behind. */
async function openTutorial() {
  const r = await render(withSafeArea(<TutorialScreen />));
  await waitFor(() => expect(screen.getByLabelText(t('tutorial.skipA11yLabel'))).toBeTruthy());
  return r;
}

async function pressSkip() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(t('tutorial.skipA11yLabel')));
  });
}

describe('skipping the tutorial', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockAuthUser = null;
    mockAuthLoading = false;
    apiCalls = 0;
    apiSettles = () => {};
  });

  it('leaves the screen, signed out', async () => {
    const r = await openTutorial();
    await pressSkip();

    expect(jest.mocked(router.replace)).toHaveBeenCalledWith('/');
    expect(await AsyncStorage.getItem('@murlan_tutorial_progress')).toBeNull();
    await r.unmount();
  });

  it('leaves the screen without waiting for the account half to answer', async () => {
    // The device flows run signed out, but a signed-in player takes the same
    // control — and `markTutorialSeen` posts to the server on that path. The
    // request is deliberately left hanging here: whether the player gets off
    // this screen must not depend on a network round trip, or a phone on a bad
    // connection has a Skip button that does nothing.
    mockAuthUser = { id: 'u1', username: 'p', tutorialSeenAt: null };
    const r = await openTutorial();
    await waitFor(() => expect(apiCalls).toBeGreaterThan(0));

    await pressSkip();

    expect(jest.mocked(router.replace)).toHaveBeenCalledWith('/');
    apiSettles();
    await r.unmount();
  });

  it('leaves the screen even when clearing the resume marker never answers', async () => {
    // A rejection would surface; a promise that never settles would not, and
    // that is what the artefacts look like. Nothing reads this key again until
    // the screen is next opened, so the navigation must not wait for it.
    const removeItem = jest
      .spyOn(AsyncStorage, 'removeItem')
      .mockImplementation(() => new Promise<void>(() => {}));
    try {
      const r = await openTutorial();
      await pressSkip();

      expect(jest.mocked(router.replace)).toHaveBeenCalledWith('/');
      await r.unmount();
    } finally {
      removeItem.mockRestore();
    }
  });
});
