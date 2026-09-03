// tests/native/registerCheckEmail.test.tsx — #897: registration answers
// neutrally, with no user object in the body, so the client learns whether it
// actually signed in from GET /api/auth/me. A person who registers must see a
// "check your email" state either way, never a silent no-op (a bare navigate
// to "/", as if nothing had happened) and never a spurious error (the
// pre-migration fallback, which mints no session, is not a failure).
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn(), back: jest.fn() },
}));

const mockApiRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

import AuthScreen from '@/app/auth';
import { AuthProvider } from '@/context/AuthContext';
import { en as locale } from '@/locales/en';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SIGNED_IN = {
  id: 'u1',
  username: 'newplayer',
  tutorialSeenAt: null,
  email: 'newplayer@example.test',
  emailVerified: false,
};

const mockFetch = jest.fn<() => Promise<unknown>>();

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthProvider>
        <AuthScreen />
      </AuthProvider>
    </SafeAreaProvider>
  );

async function fillAndSubmitRegister() {
  await act(async () => {
    fireEvent.press(screen.getByRole('tab', { name: locale['auth.tabRegister'] }));
  });
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText(locale['auth.usernameA11yLabel']), 'newplayer');
  });
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText(locale['auth.emailA11yLabel']), 'newplayer@example.test');
  });
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText(locale['auth.passwordA11yLabel']), 'password123');
  });
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: locale['auth.submitRegister'] }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApiRequest.mockResolvedValue({ ok: true, json: async () => ({}) });
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe('registering signs this device in', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => SIGNED_IN });
  });

  it('shows the check-your-email state instead of navigating straight in', async () => {
    const view = await mount();
    await fillAndSubmitRegister();

    await waitFor(() => expect(screen.getByText(locale['auth.checkEmailTitle'], { includeHiddenElements: true })).toBeTruthy());
    expect(
      screen.getByText(locale['auth.checkEmailBody'], { includeHiddenElements: true })
    ).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    view.unmount();
  });

  it('continues into the app on request, not on its own', async () => {
    const view = await mount();
    await fillAndSubmitRegister();
    await waitFor(() => expect(screen.getByText(locale['auth.checkEmailTitle'], { includeHiddenElements: true })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['auth.checkEmailContinue'] }));
    });

    expect(mockReplace).toHaveBeenCalledWith('/');
    view.unmount();
  });
});

describe('registering to an address this device did not end up signed in with', () => {
  // The pre-migration fallback (docs/DEPLOY-RUNBOOK.md #897): the response is
  // the same neutral 202, but no session was minted, so GET /api/auth/me
  // answers 401.
  beforeEach(() => {
    mockFetch.mockResolvedValue({ status: 401, ok: false });
  });

  it('still shows the check-your-email state — not a spurious error', async () => {
    const view = await mount();
    await fillAndSubmitRegister();

    await waitFor(() => expect(screen.getByText(locale['auth.checkEmailTitle'], { includeHiddenElements: true })).toBeTruthy());
    expect(screen.queryByText(locale['auth.unknownError'])).toBeNull();
    view.unmount();
  });

  it('offers a way back to signing in rather than a dead end', async () => {
    const view = await mount();
    await fillAndSubmitRegister();
    await waitFor(() => expect(screen.getByText(locale['auth.checkEmailTitle'], { includeHiddenElements: true })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['auth.checkEmailBackToSignIn'] }));
    });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByLabelText(locale['auth.usernameA11yLabel'])).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: locale['auth.tabLogin'] }).props.accessibilityState.selected
    ).toBe(true);
    view.unmount();
  });
});
