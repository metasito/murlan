// tests/native/lobbyReplaceSaved.test.tsx — Start never replaces a resumable
// offline match without asking.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { en as locale } from '@/locales/en';

const mockSetupGame = jest.fn();
let mockHasSavedGame = false;
jest.mock('@/context/gameHooks', () => ({
  useLocalSession: () => ({ setupGame: mockSetupGame, hasSavedGame: mockHasSavedGame, bootSettled: true }),
}));

jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ mode: 'bot' }),
}));

import LobbyScreen from '@/app/lobby';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LobbyScreen />
    </SafeAreaProvider>
  );

const start = () => fireEvent.press(screen.getAllByLabelText(locale['lobby.start'])[0]);

beforeEach(() => {
  mockSetupGame.mockClear();
  mockHasSavedGame = false;
});

describe('Start in the lobby', () => {
  it('deals straight away when nothing is saved', async () => {
    const view = await show();
    await start();
    expect(mockSetupGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(locale['lobby.replaceSavedTitle'])).toBeNull();
    await view.unmount();
  });

  it('asks before replacing a saved match, and Cancel changes nothing', async () => {
    mockHasSavedGame = true;
    const view = await show();
    await start();
    expect(screen.getByText(locale['lobby.replaceSavedTitle'])).toBeTruthy();
    expect(mockSetupGame).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(mockSetupGame).not.toHaveBeenCalled();
    expect(screen.queryByText(locale['lobby.replaceSavedTitle'])).toBeNull();
    await view.unmount();
  });

  it('deals once Replace is confirmed', async () => {
    mockHasSavedGame = true;
    const view = await show();
    await start();
    await fireEvent.press(screen.getByTestId('confirm-accept'));
    expect(mockSetupGame).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
