// tests/native/lobbyReplaceSaved.test.tsx — Start never replaces a resumable
// offline match without asking.
import { describe, it, expect, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decodeOfflineSave, OFFLINE_SAVE_KEY } from '@/lib/offlineSave';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';
import { setWindow } from './harness/env';
import { useGameTable } from '@/context/GameContext';
import { aThreePlayed, state } from '../support/game';
import { offlineSave, renderAppHook } from './harness/renderApp';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ mode: 'bot' }),
}));

import LobbyScreen from '@/app/lobby';

const SAVED = state({ firstPlayMade: true, playedRanks: aThreePlayed() });

/** The lobby, with `SAVED` on the device if `saved`; `result.current` is the table the offline game holds. */
const show = async (saved = false) => {
  await setWindow({ width: 390, height: 844 });
  return renderAppHook(() => useGameTable().gameState, {
    saved: saved ? offlineSave(SAVED) : undefined,
    wrap: (probe) => (
      <>
        {probe}
        <LobbyScreen />
      </>
    ),
  });
};

const start = () => fireEvent.press(screen.getAllByLabelText(locale['lobby.start'])[0]);

describe('Start in the lobby', () => {
  it('deals straight away when nothing is saved', async () => {
    const view = await show();
    await start();
    expect(view.result.current).not.toBeNull();
    expect(screen.queryByText(locale['lobby.replaceSavedTitle'])).toBeNull();
    await view.unmount();
  });

  it('asks before replacing a saved match, and Cancel changes nothing', async () => {
    const view = await show(true);
    await start();
    expect(screen.getByText(locale['lobby.replaceSavedTitle'])).toBeTruthy();
    expect(view.result.current).toBeNull();

    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(view.result.current).toBeNull();
    expect(decodeOfflineSave(await AsyncStorage.getItem(OFFLINE_SAVE_KEY))).toMatchObject({ kind: 'ok', save: { gameState: SAVED } });
    expect(screen.queryByText(locale['lobby.replaceSavedTitle'])).toBeNull();
    await view.unmount();
  });

  it('deals once Replace is confirmed', async () => {
    const view = await show(true);
    await start();
    await fireEvent.press(screen.getByTestId('confirm-accept'));
    expect(view.result.current).not.toBeNull();
    expect(view.result.current).not.toEqual(SAVED);
    await view.unmount();
  });
});
