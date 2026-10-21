// tests/native/accountRecovery.test.tsx — #893: renders the two new screens
// and proves the entry points into them are actually reachable controls, not
// just strings that happen to exist (a source scan cannot tell the two
// apart).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn<() => boolean>();
const mockUseLocalSearchParams = jest.fn<() => Record<string, string>>(() => ({}));
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

import VerifyEmailScreen from '@/app/verify-email';
import RecoverScreen from '@/app/recover';
import AuthScreen from '@/app/auth';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import * as i18n from '@/lib/i18n';
import { en as locale } from '@/locales/en';
import { renderApp } from './harness/renderApp';
import { httpRequests, route, unreachable } from './mocks/http';

type Answer = Parameters<typeof route>[2];

/** Every request these screens send through api(); each is answered alike. */
const ACCOUNT_CALLS = [
  '/api/auth/register',
  '/api/auth/add-email',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
];
const serverAnswers = (answer: Answer) => ACCOUNT_CALLS.forEach((path) => route('POST', path, answer));
const accountCalls = () =>
  httpRequests()
    .filter((r) => ACCOUNT_CALLS.includes(r.path))
    .map((r) => [r.method, r.path, r.body]);
const ok = { body: { ok: true } };
const inFlight: Answer = () => new Promise(() => {});

// VerifyEmailScreen's refreshUser() rides the boot check's own `GET /api/auth/me`,
// so counting it is how these tests can tell it actually fired.
const meAsked = () => httpRequests().filter((r) => r.method === 'GET' && r.path === '/api/auth/me').length;
let me: Answer;
const app = (ui: React.ReactElement, cached: AuthUser | null = null) => renderApp(ui, { me, cached });

beforeEach(() => {
  jest.clearAllMocks();
  me = { status: 401 };
  mockCanGoBack.mockReturnValue(true);
  mockUseLocalSearchParams.mockReturnValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the auth calls that send a mail', () => {
  it('carry the active locale', async () => {
    serverAnswers({ body: { id: 'u1', username: 'Ana' } });
    const auth: { current?: ReturnType<typeof useAuth> } = {};
    function Capture() {
      const value = useAuth();
      React.useEffect(() => {
        auth.current = value;
      });
      return null;
    }
    const view = await app(<Capture />);
    await waitFor(() => expect(auth.current?.loading).toBe(false));

    jest.spyOn(i18n, 'getLocale').mockReturnValue('it');
    await act(async () => {
      await auth.current!.register('Ana', 'password123', 'ana@example.test');
      await auth.current!.addEmail('ana@example.test');
    });

    expect(accountCalls()).toContainEqual(['POST', '/api/auth/register', {
      username: 'Ana',
      password: 'password123',
      email: 'ana@example.test',
      locale: 'it',
    }]);
    expect(accountCalls()).toContainEqual(['POST', '/api/auth/add-email', { email: 'ana@example.test', locale: 'it' }]);
    await view.unmount();
  });
});

describe('app/verify-email', () => {
  const mount = (cached: AuthUser | null = null) => app(<VerifyEmailScreen />, cached);

  it('redeems the pasted code, refreshes the signed-in user, and says so before leaving', async () => {
    serverAnswers(ok);
    const view = await mount();
    await waitFor(() => expect(meAsked()).toBe(1)); // the boot check settles first

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['auth.emailA11yLabel']), 'player@example.test');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['verifyEmail.codeA11yLabel']), '123456');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });

    expect(accountCalls()).toContainEqual(['POST', '/api/auth/verify-email', {
      email: 'player@example.test',
      code: '123456',
    }]);
    await waitFor(() => expect(meAsked()).toBe(2)); // refreshUser's own fetchMe

    // The screen confirms rather than vanishing: leaving silently is
    // indistinguishable from a tap that did nothing. Asked for by its group
    // label, not its text — StateBlock hides its own words from the
    // accessibility tree, and RNTL skips hidden elements by default.
    await waitFor(() =>
      expect(
        screen.getByLabelText(`${locale['verifyEmail.successTitle']}. ${locale['verifyEmail.successBody']}`)
      ).toBeTruthy()
    );
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.done'] }));
    });
    expect(mockBack).toHaveBeenCalled();
    await view.unmount();
  });

  it('goes home instead of back when there is nowhere to go back to', async () => {
    mockCanGoBack.mockReturnValue(false);
    serverAnswers(ok);
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['auth.emailA11yLabel']), 'player@example.test');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['verifyEmail.codeA11yLabel']), '123456');
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

  it('asks for an email before submitting an empty one', async () => {
    const view = await mount();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });

    expect(screen.getByText(locale['verifyEmail.missingEmail'])).toBeTruthy();
    expect(accountCalls()).toEqual([]);
    await view.unmount();
  });

  it('asks for a code once the email is filled in', async () => {
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['auth.emailA11yLabel']), 'player@example.test');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });

    expect(screen.getByText(locale['verifyEmail.missingCode'])).toBeTruthy();
    expect(accountCalls()).toEqual([]);
    await view.unmount();
  });

  it('shows a fallback message when the server refuses the code', async () => {
    serverAnswers(unreachable);
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['auth.emailA11yLabel']), 'player@example.test');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['verifyEmail.codeA11yLabel']), '000000');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['verifyEmail.submit'] }));
    });

    await waitFor(() => expect(screen.getByText(locale['verifyEmail.failed'])).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('prefills the email from the route param and offers a resend when signed in', async () => {
    // A different address than the param: the field must keep the param's
    // value (the prefill only fills an empty field), and resend must still
    // target the signed-in account's own address, not the field.
    mockUseLocalSearchParams.mockReturnValue({ email: 'fresh@example.test' });
    serverAnswers(ok);
    me = { body: {
        id: 'u1',
        username: 'fresh',
        tutorialSeenAt: null,
        email: 'signedin@example.test',
        emailVerified: false,
      } };
    const view = await mount();

    // The resend button only renders once `user` has landed (AuthContext's
    // boot fetch), so finding it first means the prefill useEffect has
    // already run its once chance to overwrite the field below.
    const resend = await screen.findByRole('button', { name: locale['verifyEmail.resend'] });
    const emailInput = screen.getByLabelText(locale['auth.emailA11yLabel']);
    expect(emailInput.props.value).toBe('fresh@example.test');

    jest.spyOn(i18n, 'getLocale').mockReturnValue('it');
    await act(async () => {
      fireEvent.press(resend);
    });

    expect(accountCalls()).toContainEqual(['POST', '/api/auth/resend-verification', { locale: 'it' }]);
    const resendSent = locale['verifyEmail.resendSent'].replace('{{email}}', 'signedin@example.test');
    await waitFor(() => expect(screen.getByText(resendSent)).toBeTruthy());
    await view.unmount();
  });

  it('offers no resend to a cached user whose verification is unknown', async () => {
    me = unreachable;
    const view = await mount({ id: 'u1', username: 'Ana', email: 'cached@example.test' });

    const emailInput = screen.getByLabelText(locale['auth.emailA11yLabel']);
    await waitFor(() => expect(emailInput.props.value).toBe('cached@example.test'));
    expect(screen.queryByRole('button', { name: locale['verifyEmail.resend'] })).toBeNull();
    await view.unmount();
  });

  it('offers no resend to a cached user while the boot check is still in flight', async () => {
    me = () => new Promise<never>(() => {});
    const cached = { id: 'u1', username: 'Ana', email: 'cached@example.test' };
    const view = await renderApp(<VerifyEmailScreen />, { me, cached, booted: false });

    const emailInput = await screen.findByLabelText(locale['auth.emailA11yLabel']);
    await waitFor(() => expect(emailInput.props.value).toBe('cached@example.test'));
    expect(meAsked()).toBe(1);
    expect(screen.queryByRole('button', { name: locale['verifyEmail.resend'] })).toBeNull();
    await view.unmount();
  });

  it('prefills the email from the signed-in user when there is no route param', async () => {
    mockUseLocalSearchParams.mockReturnValue({});
    me = { body: {
        id: 'u1',
        username: 'signedin',
        tutorialSeenAt: null,
        email: 'signedin@example.test',
        emailVerified: false,
      } };
    const view = await mount();

    const emailInput = await screen.findByLabelText(locale['auth.emailA11yLabel']);
    await waitFor(() => expect(emailInput.props.value).toBe('signedin@example.test'));
    await view.unmount();
  });
});

describe('app/recover', () => {
  const mount = () => app(<RecoverScreen />);

  it('requests a reset, then submits the code and new password from step two', async () => {
    serverAnswers(ok);
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['recover.emailA11yLabel']), 'player@example.test');
    });
    jest.spyOn(i18n, 'getLocale').mockReturnValue('sq');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['recover.requestSubmit'] }));
    });

    await waitFor(() =>
      expect(accountCalls()).toContainEqual(['POST', '/api/auth/request-password-reset', {
        email: 'player@example.test',
        locale: 'sq',
      }])
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

    expect(accountCalls()).toContainEqual(['POST', '/api/auth/reset-password', {
      token: 'the-reset-code',
      newPassword: 'a-new-password',
    }]);
    // reset-password mints no session — back to sign-in with a notice, never
    // straight into the app.
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/auth', params: { notice: 'passwordReset' } });
    await view.unmount();
  });

  it('the email field stops taking keystrokes while the request is in flight', async () => {
    // Never resolves: the request stays in flight for the rest of the case.
    serverAnswers(inFlight);
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['recover.emailA11yLabel']), 'player@example.test');
    });
    await act(async () => {
      fireEvent(screen.getByLabelText(locale['recover.emailA11yLabel']), 'submitEditing');
    });
    await waitFor(() =>
      expect(screen.getByLabelText(locale['recover.emailA11yLabel']).props.editable).toBe(false),
    );

    await view.unmount();
  });

  it('a second submit while the reset request is in flight issues no second request', async () => {
    serverAnswers(inFlight);
    const view = await mount();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(locale['recover.emailA11yLabel']), 'player@example.test');
    });
    // The prop, not the event: RNTL's fireEvent refuses any event on a
    // non-editable input, which would assert the harness. Dispatching anyway is
    // what the web build does (lib/useGuardedSubmit.ts says why).
    // Re-read each time — the browser re-attaches the handler every render.
    const submit = () => screen.getByLabelText(locale['recover.emailA11yLabel']).props.onSubmitEditing;
    await act(async () => {
      submit()();
    });
    await act(async () => {
      submit()();
    });
    expect(accountCalls()).toHaveLength(1);

    await view.unmount();
  });

  it('a player who already holds a code skips straight to step two', async () => {
    const view = await mount();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: locale['recover.haveCodeAlready'] }));
    });

    expect(screen.getByLabelText(locale['recover.codeA11yLabel'])).toBeTruthy();
    expect(accountCalls()).toEqual([]);
    await view.unmount();
  });
});

describe('app/auth reaches both new screens', () => {
  const mount = () => app(<AuthScreen />);

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
    serverAnswers({ body: {} });
    me = { body: {
        id: 'u1',
        username: 'newplayer',
        tutorialSeenAt: null,
        email: 'newplayer@example.test',
        emailVerified: false,
      } };
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

    // The push happens on submit itself, before any interstitial button is
    // touched — asserted here so deleting it would fail this, not just the
    // button-press assertion below.
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/verify-email',
        params: { email: 'newplayer@example.test' },
      })
    );
    mockPush.mockClear();

    const verifyNow = await screen.findByRole('button', { name: locale['auth.checkEmailVerifyNow'] });
    await act(async () => {
      fireEvent.press(verifyNow);
    });

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/verify-email',
      params: { email: 'newplayer@example.test' },
    });
    await view.unmount();
  });

  // Coming back from /verify-email lands on this same interstitial. Reading
  // the state it was created in rather than the account's would leave it
  // still asking for a code already redeemed.
  it('the interstitial reports a verified address instead of asking again', async () => {
    serverAnswers({ body: {} });
    const signedIn = {
      id: 'u1',
      username: 'newplayer',
      tutorialSeenAt: null,
      email: 'newplayer@example.test',
      emailVerified: true,
    };
    me = { body: signedIn };
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

    const verified = `${locale['auth.checkEmailVerifiedTitle']}. ${locale['auth.checkEmailVerifiedBody']}`;
    const unverified = `${locale['auth.checkEmailTitle']}. ${locale['auth.checkEmailBody']}`;
    await waitFor(() => expect(screen.getByLabelText(verified)).toBeTruthy());
    expect(screen.queryByLabelText(unverified)).toBeNull();
    expect(screen.queryByRole('button', { name: locale['auth.checkEmailVerifyNow'] })).toBeNull();
    await view.unmount();
  });
});
