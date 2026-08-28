// tests/native/tutorialOnce.test.tsx — the first-run tutorial is offered once
// ever, however the player leaves it (UX-08), and once per *player* rather
// than once per install.
//
// The title screen pushes the tutorial whenever neither the device nor the
// account says it has been offered, and it runs that check on every mount —
// every `router.replace("/")` in the app remounts it. So the flag has to be
// written when the tutorial opens: the back gesture, the header chevron and
// the two rows on the final beat all leave the screen without passing through
// any other write.
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

// Read when useAuth() is called, not when the factory runs, so each test can
// set the signed-in state it needs before it renders.
let mockAuthUser: { id: string; username: string; tutorialSeenAt: string | null } | null = null;
let mockAuthLoading = false;
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuthUser, loading: mockAuthLoading }),
}));
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({ hasSavedGame: false, resumeGame: () => false }),
}));
jest.mock('@/context/SocketContext', () => ({ useSocket: () => ({ gameInvites: [] }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(async () => ({ json: async () => ({}) })),
}));

// Both screens stagger themselves in on mount; under reduced motion the values
// are set outright, so nothing here waits on an animation it does not assert.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { router } from 'expo-router';
import { apiRequest } from '@/lib/query-client';
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

/**
 * Renders the title screen and waits out its onboarding gate, so that a test
 * asserting the tutorial was *not* offered is asserting about a decision that
 * has been made.
 *
 * The gate reads the device flag and pushes in a `.then`, and the screen
 * renders in full before that resolves. Awaiting the very promise whose `.then`
 * would push queues the assertion behind it: once it resolves here, the push
 * has either happened or is never going to.
 */
async function renderHomeAndSettle() {
  const getItem = watchGetItem();
  const home = await render(withSafeArea(<HomeScreen />));
  await waitFor(() => expect(getItem).toHaveBeenCalledWith(SEEN_KEY));
  await act(async () => {
    await Promise.all(getItem.mock.results.map((r) => r.value));
  });
  return home;
}

// One spy for the file, never restored: restoring it puts back something the
// vendor AsyncStorage mock cannot serve from, and every later test that reads
// a key gets `undefined` instead of a promise. Calls are cleared per test.
let getItemSpy: jest.SpiedFunction<typeof AsyncStorage.getItem> | null = null;
function watchGetItem() {
  if (!getItemSpy) getItemSpy = jest.spyOn(AsyncStorage, 'getItem');
  return getItemSpy;
}

describe('opening the tutorial is what marks it seen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockAuthUser = null;
    mockAuthLoading = false;
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
    mockAuthUser = null;
    mockAuthLoading = false;
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

    const home = await renderHomeAndSettle();

    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');
    await home.unmount();
  });
});

describe('the account answers where the install cannot', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockAuthUser = null;
    mockAuthLoading = false;
  });

  it('does not offer it to a player whose account has opened it before', async () => {
    // A second phone, or the same one reinstalled: nothing local to go on.
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: new Date().toISOString() };

    const home = await renderHomeAndSettle();

    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');
    await home.unmount();
  });

  it('offers it to a signed-in player whose account has not', async () => {
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

    const home = await render(withSafeArea(<HomeScreen />));

    await waitFor(() => expect(jest.mocked(router.push)).toHaveBeenCalledWith('/tutorial'));
    await home.unmount();
  });

  it('holds the offer until the account has been asked, then makes it', async () => {
    // The title screen renders while AuthProvider is still resolving the
    // session. Offering during that window is offering before the one source
    // that outlives the install has answered.
    mockAuthLoading = true;
    const home = await render(withSafeArea(<HomeScreen />));
    await act(async () => {});
    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');

    mockAuthLoading = false;
    await act(async () => {
      home.rerender(withSafeArea(<HomeScreen />));
    });

    await waitFor(() => expect(jest.mocked(router.push)).toHaveBeenCalledWith('/tutorial'));
    await home.unmount();
  });

  it('catches the account up when only the device was ever told', async () => {
    // The write that should have marked the account never landed — offline, or
    // on a session that had expired. Nothing else would ever retry it.
    await AsyncStorage.setItem(SEEN_KEY, '1');
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

    const home = await renderHomeAndSettle();

    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');
    await waitFor(() =>
      expect(jest.mocked(apiRequest)).toHaveBeenCalledWith('POST', '/api/users/me/tutorial-seen')
    );
    await home.unmount();
  });

  it('marks the account when a signed-in player opens the tutorial', async () => {
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

    const r = await render(withSafeArea(<TutorialScreen />));

    await waitFor(() =>
      expect(jest.mocked(apiRequest)).toHaveBeenCalledWith('POST', '/api/users/me/tutorial-seen')
    );
    await r.unmount();
  });

  it('asks nothing of the server when nobody is signed in', async () => {
    const r = await render(withSafeArea(<TutorialScreen />));

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(SEEN_KEY)).toBe('1');
    });
    expect(jest.mocked(apiRequest)).not.toHaveBeenCalled();
    await r.unmount();
  });
});
