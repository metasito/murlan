// tests/native/authNextDestination.test.tsx — signing in from "Play online"
// must return to that flow. `destinationAfterAuth` decides where, and is unit
// tested; what needs rendering is that the screen reads the param at all and
// hands the answer to the router instead of the hardcoded "/".
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

// Wrapped rather than passed by reference: `import AuthScreen` hoists above
// `const mockReplace`, so a factory that reads the binding eagerly captures
// `undefined` and every replace throws into the screen's own catch.
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: jest.fn(),
    back: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
}));

import AuthScreen from '@/app/auth';
import { returnPathFor } from '@/lib/authRedirect';
import { en as locale } from '@/locales/en';
import { renderApp } from './harness/renderApp';
import { route } from './mocks/http';

const mount = () => {
  route('POST', '/api/auth/login', { body: { id: 'u1', username: 'ana' } });
  return renderApp(<AuthScreen />);
};

async function signIn() {
  await fireEvent.changeText(screen.getByLabelText(locale['auth.usernameA11yLabel']), 'ana');
  await fireEvent.changeText(screen.getByLabelText(locale['auth.passwordA11yLabel']), 'secret1');
  await fireEvent.press(screen.getByRole('button', { name: locale['auth.submitLogin'] }));
}

describe('where signing in lands', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockParams = {};
  });

  it('returns to the flow that sent the player here', async () => {
    mockParams = { next: '/(online)/quickmatch' };
    const view = await mount();

    await signIn();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(online)/quickmatch'));

    await view.unmount();
  });

  it('returns a deep link into the online group to the screen it named, params and all', async () => {
    for (const [segments, params, landing] of [
      [['(online)', 'replay'], { id: 'g 7' }, '/(online)/replay?id=g%207'],
      [['(online)', 'history'], {}, '/(online)/history'],
      [['(online)', 'friends'], {}, '/(online)/friends'],
      [['(online)', 'leaderboard'], {}, '/(online)/leaderboard'],
    ] as const) {
      mockReplace.mockClear();
      mockParams = { next: returnPathFor(segments, params) };
      const view = await mount();

      await signIn();
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(landing));

      await view.unmount();
    }
  });

  it('lands on home when nothing sent them', async () => {
    const view = await mount();

    await signIn();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));

    await view.unmount();
  });

  it('refuses a destination outside the app', async () => {
    mockParams = { next: 'https://evil.example.com' };
    const view = await mount();

    await signIn();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));

    await view.unmount();
  });
});
