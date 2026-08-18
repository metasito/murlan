// tests/native/tutorialOnce.test.tsx — the first-run tutorial is offered once
// ever, however the player leaves it (UX-08).
//
// The title screen pushes the tutorial whenever `@murlan_tutorial_seen` is
// unset, and it runs that check on every mount — every `router.replace("/")`
// in the app remounts it. So the flag has to be written when the tutorial
// opens: the back gesture, the header chevron and the two rows on the final
// beat all leave the screen without passing through any other write.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

// The settings sheet reaches for SettingsProvider and has nothing to do with
// the onboarding gate.
jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));

jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({ hasSavedGame: false, resumeGame: () => false }),
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));

// Both screens stagger themselves in on mount; under reduced motion the values
// are set outright, so nothing here waits on an animation it does not assert.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { router } from 'expo-router';
import TutorialScreen from '@/app/tutorial';
import HomeScreen from '@/app/index';
import { t } from '@/lib/i18n';

const SEEN_KEY = '@murlan_tutorial_seen';
const PROGRESS_KEY = '@murlan_tutorial_progress';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

describe('opening the tutorial is what marks it seen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('sets the flag on mount, before the player has done anything', async () => {
    const r = await render(withSafeArea(<TutorialScreen />));
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(SEEN_KEY)).toBe('1');
    });
    await r.unmount();
  });

  it('leaves it set when the player backs out at the first beat', async () => {
    const r = await render(withSafeArea(<TutorialScreen />));
    // The screen renders nothing until the stored progress has been read.
    await waitFor(() => expect(screen.getByLabelText(t('tutorial.backA11yLabel'))).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText(t('tutorial.backA11yLabel')));
    });

    expect(jest.mocked(router.back)).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(SEEN_KEY)).toBe('1');
    await r.unmount();
  });

  it('still resumes at the beat the player left', async () => {
    // Backing out keeps the resume marker: the flag says "offered", the
    // progress says "where", and they are not the same question.
    await AsyncStorage.setItem(PROGRESS_KEY, '2');
    const r = await render(withSafeArea(<TutorialScreen />));

    await waitFor(() => expect(screen.getByText(/^3 \/ \d+$/)).toBeTruthy());
    expect(await AsyncStorage.getItem(PROGRESS_KEY)).toBe('2');
    await r.unmount();
  });
});

describe('the title screen offers the tutorial only while the flag is unset', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('pushes it on a fresh install', async () => {
    const r = await render(withSafeArea(<HomeScreen />));
    await waitFor(() => expect(jest.mocked(router.push)).toHaveBeenCalledWith('/tutorial'));
    await r.unmount();
  });

  it('never pushes it again once the tutorial has been opened', async () => {
    // Exactly the state a player who backed straight out is left in.
    const opened = await render(withSafeArea(<TutorialScreen />));
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(SEEN_KEY)).toBe('1');
    });
    await opened.unmount();

    // The gate is `getItem(SEEN_KEY).then(...)`, and the screen renders in full
    // before it resolves — so a negative assertion has to wait on that promise
    // itself. Awaiting the very promise whose `.then` would push queues this
    // continuation behind it: once it resolves here, the push has either
    // happened or is never going to.
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const home = await render(withSafeArea(<HomeScreen />));
    await waitFor(() => expect(getItem).toHaveBeenCalledWith(SEEN_KEY));
    await act(async () => {
      await Promise.all(getItem.mock.results.map((r) => r.value));
    });

    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');
    await home.unmount();
    getItem.mockRestore();
  });
});
