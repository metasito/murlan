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
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useIsFocused: () => true,
}));

// The settings sheet reaches for SettingsProvider and has nothing to do with
// the onboarding gate.
jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));

// The signed-in state each test boots into.
let authUser: { id: string; username: string; tutorialSeenAt: string | null } | null = null;

// Both screens stagger themselves in on mount; under reduced motion the values
// are set outright, so nothing here waits on an animation it does not assert.
import { router } from 'expo-router';
import TutorialScreen from '@/app/tutorial';
import HomeScreen from '@/app/index';
import { t } from '@/lib/i18n';

import { TUTORIAL_SEEN_KEY as SEEN_KEY, TUTORIAL_PROGRESS_KEY as PROGRESS_KEY } from '@/lib/storageKeys';
import { setMotion, setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { httpRequests, route, type HttpReply } from './mocks/http';

const show = async (ui: React.ReactElement) => {
  await setWindow({ width: 390, height: 844 });
  return renderApp(ui, { user: authUser });
};
/** What the app asked the server beyond the boot check. */
const asked = () =>
  httpRequests()
    .filter((r) => !(r.method === 'GET' && r.path === '/api/auth/me'))
    .map((r) => [r.method, r.path]);
const TUTORIAL_SEEN: [string, string] = ['POST', '/api/users/me/tutorial-seen'];

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
  const home = await show(<HomeScreen />);
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

beforeEach(() => setMotion('on'));

describe('opening the tutorial is what marks it seen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    authUser = null;
    route(...TUTORIAL_SEEN, { body: {} });
  });

  it('sets the flag on mount, before the player has done anything', async () => {
    const r = await show(<TutorialScreen />);
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(SEEN_KEY)).toBe('1');
    });
    await r.unmount();
  });

  it('leaves it set when the player backs out at the first beat', async () => {
    const r = await show(<TutorialScreen />);
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
    await AsyncStorage.setItem(PROGRESS_KEY, 'respond');
    const r = await show(<TutorialScreen />);

    await waitFor(() => expect(screen.getByText(/^3 \/ \d+$/)).toBeTruthy());
    expect(await AsyncStorage.getItem(PROGRESS_KEY)).toBe('respond');
    await r.unmount();
  });

  it.each(['a-beat-since-removed', '2'])('starts at the first beat when the stored beat %s is unknown', async (stored) => {
    await AsyncStorage.setItem(PROGRESS_KEY, stored);
    const r = await show(<TutorialScreen />);

    await waitFor(() => expect(screen.getByText(/^1 \/ \d+$/)).toBeTruthy());
    await waitFor(async () => expect(await AsyncStorage.getItem(PROGRESS_KEY)).toBe('welcome'));
    await r.unmount();
  });
});

describe('the title screen offers the tutorial only while the flag is unset', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    authUser = null;
    route(...TUTORIAL_SEEN, { body: {} });
  });

  it('pushes it on a fresh install', async () => {
    const r = await show(<HomeScreen />);
    await waitFor(() => expect(jest.mocked(router.push)).toHaveBeenCalledWith('/tutorial'));
    await r.unmount();
  });

  it('never pushes it again once the tutorial has been opened', async () => {
    // Exactly the state a player who backed straight out is left in.
    const opened = await show(<TutorialScreen />);
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
    authUser = null;
    route(...TUTORIAL_SEEN, { body: {} });
  });

  it('does not offer it to a player whose account has opened it before', async () => {
    // A second phone, or the same one reinstalled: nothing local to go on.
    authUser = { id: 'u1', username: 'Ana', tutorialSeenAt: new Date().toISOString() };

    const home = await renderHomeAndSettle();

    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');
    await home.unmount();
  });

  it('offers it to a signed-in player whose account has not', async () => {
    authUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

    const home = await show(<HomeScreen />);

    await waitFor(() => expect(jest.mocked(router.push)).toHaveBeenCalledWith('/tutorial'));
    await home.unmount();
  });

  it('holds the offer until the account has been asked, then makes it', async () => {
    // The title screen renders while AuthProvider is still resolving the
    // session. Offering during that window is offering before the one source
    // that outlives the install has answered.
    let answer: (reply: HttpReply) => void = () => {};
    await setWindow({ width: 390, height: 844 });
    const home = await renderApp(<HomeScreen />, {
      me: () => new Promise<HttpReply>((resolve) => (answer = resolve)),
      booted: false,
    });
    await act(async () => {});
    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');

    await act(async () => answer({ status: 401 }));

    await waitFor(() => expect(jest.mocked(router.push)).toHaveBeenCalledWith('/tutorial'));
    await home.unmount();
  });

  it('catches the account up when only the device was ever told', async () => {
    // The write that should have marked the account never landed — offline, or
    // on a session that had expired. Nothing else would ever retry it.
    await AsyncStorage.setItem(SEEN_KEY, '1');
    authUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

    const home = await renderHomeAndSettle();

    expect(jest.mocked(router.push)).not.toHaveBeenCalledWith('/tutorial');
    await waitFor(() =>
      expect(asked()).toContainEqual(TUTORIAL_SEEN)
    );
    await home.unmount();
  });

  it('marks the account when a signed-in player opens the tutorial', async () => {
    authUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

    const r = await show(<TutorialScreen />);

    await waitFor(() =>
      expect(asked()).toContainEqual(TUTORIAL_SEEN)
    );
    await r.unmount();
  });

  it('asks nothing of the server when nobody is signed in', async () => {
    const r = await show(<TutorialScreen />);

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(SEEN_KEY)).toBe('1');
    });
    expect(asked()).toEqual([]);
    await r.unmount();
  });
});
