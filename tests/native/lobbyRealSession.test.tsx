// tests/native/lobbyRealSession.test.tsx — the lobby against the real GameContext:
// Start never replaces a saved match unasked, however early it is pressed.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameProvider, useGameSession, useGameTable } from '@/context/GameContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { OFFLINE_SAVE_KEY } from '@/lib/offlineSave';
import { en as locale } from '@/locales/en';

jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a) },
  useLocalSearchParams: () => ({ mode: 'bot' }),
}));

import LobbyScreen from '@/app/lobby';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const SEED = [
  { name: 'Ana', type: 'human' as const },
  { name: 'Luan', type: 'bot' as const, personality: 'luan' as const },
];

function Seed() {
  const { setupGame } = useGameSession();
  return <Text testID="seed" onPress={() => setupGame(SEED, 'free_for_all')}>seed</Text>;
}

function Probe() {
  const { hasSavedGame, resumeGame } = useGameSession();
  const { gameState } = useGameTable();
  return (
    <>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="live">{gameState ? gameState.players.map((p) => p.name).join('|') : 'none'}</Text>
      <Text testID="resume" onPress={() => resumeGame()}>resume</Text>
    </>
  );
}

const tree = (children: React.ReactNode) => (
  <NotificationProvider>
    <GameProvider>
      <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
    </GameProvider>
  </NotificationProvider>
);

/** Leaves the match from a first launch in storage, as a killed app would. */
async function storeOldMatch(): Promise<string> {
  const first = await render(tree(<Seed />));
  await fireEvent.press(screen.getByTestId('seed'));
  await waitFor(async () => expect(await AsyncStorage.getItem(OFFLINE_SAVE_KEY)).not.toBeNull());
  await act(async () => { first.unmount(); });
  return (await AsyncStorage.getItem(OFFLINE_SAVE_KEY)) as string;
}

const start = () => fireEvent.press(screen.getAllByLabelText(locale['lobby.start'])[0]);

beforeEach(async () => {
  await AsyncStorage.clear();
  mockReplace.mockClear();
});

describe('Start in the lobby, against the real session', () => {
  it('Cancel leaves the saved match resumable and untouched', async () => {
    const old = await storeOldMatch();
    const view = await render(tree(<><LobbyScreen /><Probe /></>));
    await waitFor(() => expect(screen.getByTestId('saved').props.children).toBe('true'));

    await start();
    await fireEvent.press(screen.getByTestId('confirm-cancel'));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('saved').props.children).toBe('true');
    expect(await AsyncStorage.getItem(OFFLINE_SAVE_KEY)).toBe(old);
    await view.unmount();
  });

  it('Replace deals a new match and the old one is not offered back', async () => {
    const old = await storeOldMatch();
    const view = await render(tree(<><LobbyScreen /><Probe /></>));
    await waitFor(() => expect(screen.getByTestId('saved').props.children).toBe('true'));

    await start();
    await fireEvent.press(screen.getByTestId('confirm-accept'));

    expect(mockReplace).toHaveBeenCalledWith('/game');
    await waitFor(async () => {
      const stored = await AsyncStorage.getItem(OFFLINE_SAVE_KEY);
      expect(stored).not.toBeNull();
      expect(stored).not.toBe(old);
    });
    // The table now holds the lobby's players, not the seeded match.
    expect(screen.getByTestId('live').props.children).not.toBe('none');
    expect(screen.getByTestId('live').props.children).not.toContain('Ana|Luan');
    await view.unmount();
  });

  it('cannot be pressed before the stored match has been read', async () => {
    const old = await storeOldMatch();
    let land: (raw: string | null) => void = () => {};
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (land = resolve))
    );
    const view = await render(tree(<LobbyScreen />));

    await start();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText(locale['lobby.replaceSavedTitle'])).toBeNull();

    await act(async () => land(old));
    await start();
    expect(screen.getByText(locale['lobby.replaceSavedTitle'])).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    await view.unmount();
  });
});
