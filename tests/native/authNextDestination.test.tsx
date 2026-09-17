// tests/native/authNextDestination.test.tsx — signing in from "Play online"
// must return to that flow. `destinationAfterAuth` decides where, and is unit
// tested; what needs rendering is that the screen reads the param at all and
// hands the answer to the router instead of the hardcoded "/".
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
const mockLogin = jest.fn(async () => {});

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

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, register: jest.fn(), user: null }),
}));

jest.mock('@/lib/haptics', () => ({
  setHapticsMasterEnabled: jest.fn(),
  hapticsEnabled: () => false,
  hapticSelection: jest.fn(),
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticHeavy: jest.fn(),
  hapticRigid: jest.fn(),
  hapticSuccess: jest.fn(),
  hapticError: jest.fn(),
  hapticWarn: jest.fn(),
}));

jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(),
}));

import AuthScreen from '@/app/auth';
import { en as locale } from '@/locales/en';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthScreen />
    </SafeAreaProvider>
  );

async function signIn() {
  await fireEvent.changeText(screen.getByLabelText(locale['auth.usernameA11yLabel']), 'ana');
  await fireEvent.changeText(screen.getByLabelText(locale['auth.passwordA11yLabel']), 'secret1');
  await fireEvent.press(screen.getByRole('button', { name: locale['auth.submitLogin'] }));
}

describe('where signing in lands', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockLogin.mockClear();
    mockParams = {};
  });

  it('returns to the flow that sent the player here', async () => {
    mockParams = { next: '/(online)/quickmatch' };
    const view = await mount();

    await signIn();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(online)/quickmatch'));

    await view.unmount();
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
