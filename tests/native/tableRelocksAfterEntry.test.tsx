import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContext } from 'expo-router/react-navigation';
import * as ScreenOrientation from 'expo-screen-orientation';

jest.mock('expo-screen-orientation', () => ({
  ...jest.requireActual<object>('expo-screen-orientation'),
  lockAsync: jest.fn(async () => {}),
  unlockAsync: jest.fn(async () => {}),
}));

jest.mock('@/lib/device/sounds', () => ({
  ensureAudioMode: jest.fn(async () => {}),
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  holdSounds: jest.fn(() => () => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

import { GameTable } from '@/components/GameTable';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const KEEP: Card = { id: '3_clubs', rank: '3', suit: 'clubs', isJoker: false };
const seat = (id: string, name: string): Player => ({ id, name, hand: [KEEP], type: 'human' });
const STATE: GameState = {
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
};

type Listener = (e: { data: { closing: boolean } }) => void;

function fakeScreen() {
  const listeners = new Map<string, Set<Listener>>();
  const navigation = {
    addListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      return () => listeners.get(type)!.delete(listener);
    },
  };
  const emit = (type: string, closing: boolean) =>
    act(() => listeners.get(type)?.forEach((l) => l({ data: { closing } })));
  return { navigation, emit, count: (type: string) => listeners.get(type)?.size ?? 0 };
}

const noop = () => {};
const table = (navigation: unknown) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <NavigationContext.Provider value={navigation as React.ContextType<typeof NavigationContext>}>
      <GameTable
        gameState={STATE}
        viewerSeat={1}
        selectedIds={[]}
        onSelectCard={noop}
        onPlay={noop}
        onPass={noop}
        onQuit={noop}
        onExchangeGive={noop}
      />
    </NavigationContext.Provider>
  </SafeAreaProvider>
);

const landscapeLocks = () =>
  jest.mocked(ScreenOrientation.lockAsync).mock.calls.filter(
    ([lock]) => lock === ScreenOrientation.OrientationLock.LANDSCAPE
  ).length;

describe('the table re-asserts landscape once its entry transition ends (#1211)', () => {
  beforeEach(() => {
    jest.mocked(ScreenOrientation.lockAsync).mockClear();
  });

  it('locks again when the screen finishes appearing, not when it finishes leaving', async () => {
    const screen = fakeScreen();
    const view = await render(table(screen.navigation));
    expect(landscapeLocks()).toBe(1);

    await screen.emit('transitionEnd', false);
    expect(landscapeLocks()).toBe(2);

    await screen.emit('transitionEnd', true);
    expect(landscapeLocks()).toBe(2);
    await view.unmount();
  });

  it('stops listening once the table is gone', async () => {
    const screen = fakeScreen();
    const view = await render(table(screen.navigation));
    expect(screen.count('transitionEnd')).toBe(1);
    await view.unmount();
    expect(screen.count('transitionEnd')).toBe(0);
  });

  it('still locks on mount outside a navigator', async () => {
    const view = await render(table(undefined));
    expect(landscapeLocks()).toBe(1);
    await view.unmount();
  });
});
