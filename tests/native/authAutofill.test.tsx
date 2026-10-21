// tests/native/authAutofill.test.tsx — the same form serves login and
// register, so the credential hints have to switch with the tab. Without them
// react-native-web renders <input type="password"> with no autocomplete
// attribute and the browser's password manager will not offer to fill or to
// save; on iOS and Android the Keychain and the Autofill service never see the
// field either.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

import AuthScreen from '@/app/auth';
import { en as locale } from '@/locales/en';
import { renderApp } from './harness/renderApp';

const mount = () => renderApp(<AuthScreen />);

const password = () => screen.getByLabelText(locale['auth.passwordA11yLabel']);

describe('the login form offers itself to the password manager', () => {
  it('names the username field', async () => {
    const view = await mount();
    const field = screen.getByLabelText(locale['auth.usernameA11yLabel']);
    expect(field.props.autoComplete).toBe('username');
    expect(field.props.textContentType).toBe('username');
    await view.unmount();
  });

  it('asks to fill on the login tab and to save on the register tab', async () => {
    const view = await mount();
    expect(password().props.autoComplete).toBe('current-password');
    expect(password().props.textContentType).toBe('password');

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: locale['auth.tabRegister'] }));
    });

    expect(password().props.autoComplete).toBe('new-password');
    expect(password().props.textContentType).toBe('newPassword');
    await view.unmount();
  });
});
