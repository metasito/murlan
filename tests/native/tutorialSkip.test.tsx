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
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

let authUser: { id: string; username: string; tutorialSeenAt: string | null } | null = null;

// Resolved by the test, not by the route: a request that never settles is
// one of the two things this file exists to tell apart.
let apiSettles: () => void = () => {};
let apiCalls = 0;

import { router } from 'expo-router';
import TutorialScreen from '@/app/tutorial';
import { t } from '@/lib/i18n';
import { TUTORIAL_PROGRESS_KEY } from '@/lib/storageKeys';
import { setMotion, setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { route, type HttpReply } from './mocks/http';

/** Mounts the tutorial and waits out the stored-progress read it renders behind. */
async function openTutorial() {
  await setWindow({ width: 390, height: 844 });
  const r = await renderApp(<TutorialScreen />, { user: authUser });
  await waitFor(() => expect(screen.getByLabelText(t('tutorial.skipA11yLabel'))).toBeTruthy());
  return r;
}

async function pressSkip() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(t('tutorial.skipA11yLabel')));
  });
}

beforeEach(() => setMotion('on'));

describe('skipping the tutorial', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    authUser = null;
    apiCalls = 0;
    apiSettles = () => {};
    route(
      'POST',
      '/api/users/me/tutorial-seen',
      () =>
        new Promise<HttpReply>((resolve) => {
          apiCalls += 1;
          apiSettles = () => resolve({ body: {} });
        })
    );
  });

  it('leaves the screen, signed out', async () => {
    const r = await openTutorial();
    await pressSkip();

    expect(jest.mocked(router.replace)).toHaveBeenCalledWith('/');
    expect(await AsyncStorage.getItem(TUTORIAL_PROGRESS_KEY)).toBeNull();
    await r.unmount();
  });

  it('leaves the screen without waiting for the account half to answer', async () => {
    // The device flows run signed out, but a signed-in player takes the same
    // control — and `markTutorialSeen` posts to the server on that path. The
    // request is deliberately left hanging here: whether the player gets off
    // this screen must not depend on a network round trip, or a phone on a bad
    // connection has a Skip button that does nothing.
    authUser = { id: 'u1', username: 'p', tutorialSeenAt: null };
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
    const removeItem = AsyncStorage.removeItem as unknown as jest.Mock<(key: string) => Promise<void>>;
    const real = removeItem.getMockImplementation()!;
    removeItem.mockImplementation((key) => (key === TUTORIAL_PROGRESS_KEY ? new Promise<void>(() => {}) : real(key)));
    try {
      const r = await openTutorial();
      await pressSkip();

      expect(jest.mocked(router.replace)).toHaveBeenCalledWith('/');
      await r.unmount();
    } finally {
      removeItem.mockImplementation(real);
    }
  });
});
