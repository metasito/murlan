// tests/native/accountRecovery.test.tsx — #893: renders the two new screens
// and proves the entry points into them are actually reachable controls, not
// just strings that happen to exist (a source scan cannot tell the two
// apart).
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn<() => boolean>();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({}),
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

import VerifyEmailScreen from '@/app/verify-email';
import RecoverScreen from '@/app/recover';
import AuthScreen from '@/app/auth';
import { AuthProvider } from '@/context/AuthContext';
import { en as locale } from '@/locales/en';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// AuthProvider's own boot check (`GET /api/auth/me`) is a raw `fetch`, not
// `apiRequest` — see context/AuthContext.tsx's fetchMe(). VerifyEmailScreen's
// refreshUser() rides the same call, so mocking this is how these tests can
// tell it actually fired.
const mockFetch = jest.fn<() => Promise<unknown>>();

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({ status: 401, ok: false });
  mockCanGoBack.mockReturnValue(true);
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe('app/verify-email', () => {
  const mount = () =>
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <VerifyEmailScreen />
        </AuthProvider>
      </SafeAreaProvider>
    );

  it('redeems the pasted code, refreshes the signed-in user, and says so before leaving', async () => {
    mockApiRequest.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const view = await mount();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1)); // the boot check settles first

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['verifyEmail.codeA11yLabel']), 'the-raw-token');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });

    expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/auth/verify-email', { token: 'the-raw-token' });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2)); // refreshUser's own fetchMe

    // The screen confirms rather than vanishing: leaving silently is
    // indistinguishable from a tap that did nothing.
    await waitFor(() => expect(screen.getByText(locale['verifyEmail.successTitle'])).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.done'] }));
    });
    expect(mockBack).toHaveBeenCalled();
    await view.unmount();
  });

  it('goes home instead of back when there is nowhere to go back to', async () => {
    mockCanGoBack.mockReturnValue(false);
    mockApiRequest.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['verifyEmail.codeA11yLabel']), 'the-raw-token');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });
    const done = await screen.findByRole('button', { name: locale['verifyEmail.done'] });
    await act(async () => {
      fireEvent.press(done);
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
    await view.unmount();
  });

  it('asks for a code before submitting an empty one', async () => {
    const view = await mount();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });

    expect(screen.getByText(locale['verifyEmail.missingCode'])).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('shows a fallback message when the server refuses the code', async () => {
    mockApiRequest.mockRejectedValue(new Error('boom'));
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['verifyEmail.codeA11yLabel']), 'bad-token');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });

    await waitFor(() => expect(screen.getByText(locale['verifyEmail.failed'])).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
    await view.unmount();
  });
});

describe('app/recover', () => {
  const mount = () => render(<SafeAreaProvider initialMetrics={METRICS}><RecoverScreen /></SafeAreaProvider>);

  it('requests a reset, then submits the code and new password from step two', async () => {
    mockApiRequest.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['recover.emailA11yLabel']), 'player@example.test');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['recover.requestSubmit'] }));
    });

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/auth/request-password-reset', {
        email: 'player@example.test',
      })
    );

    // Step two — the code and new password fields only exist past the request.
    await waitFor(() => expect(screen.getByLabelText(locale['recover.codeA11yLabel'])).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['recover.codeA11yLabel']), 'the-reset-code');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['recover.newPasswordA11yLabel']), 'a-new-password');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['recover.resetSubmit'] }));
    });

    expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/auth/reset-password', {
      token: 'the-reset-code',
      newPassword: 'a-new-password',
    });
    // reset-password mints no session — back to sign-in with a notice, never
    // straight into the app.
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/auth', params: { notice: 'passwordReset' } });
    await view.unmount();
  });

  it('a player who already holds a code skips straight to step two', async () => {
    const view = await mount();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['recover.haveCodeAlready'] }));
    });

    expect(screen.getByLabelText(locale['recover.codeA11yLabel'])).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
    await view.unmount();
  });
});

describe('app/auth reaches both new screens', () => {
  const mount = () =>
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <AuthScreen />
        </AuthProvider>
      </SafeAreaProvider>
    );

  it('the login tab carries a reachable "forgot password" control into /recover', async () => {
    const view = await mount();

    const forgot = await screen.findByRole('button', { name: locale['auth.forgotPassword'] });
    await act(async () => {
      fireEvent.press(forgot);
    });

    expect(mockPush).toHaveBeenCalledWith('/recover');
    await view.unmount();
  });

  it('the register interstitial carries a reachable control into /verify-email', async () => {
    mockApiRequest.mockResolvedValue({ ok: true, json: async () => ({}) });
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        id: 'u1',
        username: 'newplayer',
        tutorialSeenAt: null,
        email: 'newplayer@example.test',
        emailVerified: false,
      }),
    });
    const view = await mount();

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

    const verifyNow = await screen.findByRole('button', { name: locale['auth.checkEmailVerifyNow'] });
    await act(async () => {
      fireEvent.press(verifyNow);
    });

    expect(mockPush).toHaveBeenCalledWith('/verify-email');
    await view.unmount();
  });

  // Coming back from /verify-email lands on this same interstitial. Reading
  // the state it was created in rather than the account's would leave it
  // still asking for a code already redeemed.
  it('the interstitial reports a verified address instead of asking again', async () => {
    mockApiRequest.mockResolvedValue({ ok: true, json: async () => ({}) });
    const me = {
      id: 'u1',
      username: 'newplayer',
      tutorialSeenAt: null,
      email: 'newplayer@example.test',
      emailVerified: true,
    };
    mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => me });
    const view = await mount();

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

    await waitFor(() => expect(screen.getByText(locale['auth.checkEmailVerifiedTitle'])).toBeTruthy());
    expect(screen.queryByText(locale['auth.checkEmailTitle'])).toBeNull();
    expect(screen.queryByRole('button', { name: locale['auth.checkEmailVerifyNow'] })).toBeNull();
    await view.unmount();
  });
});
