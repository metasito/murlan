import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContext } from 'expo-router/react-navigation';
import * as ScreenOrientation from 'expo-screen-orientation';

type OrientationListener = (e: { orientationInfo: { orientation: number } }) => void;
const mockUikit = new Set<OrientationListener>();
jest.mock('expo-screen-orientation', () => ({
  ...jest.requireActual<object>('expo-screen-orientation'),
  lockAsync: jest.fn(async () => {}),
  unlockAsync: jest.fn(async () => {}),
  getOrientationAsync: jest.fn(() => new Promise(() => {})),
  addOrientationChangeListener: (listener: OrientationListener) => {
    mockUikit.add(listener);
    return { remove: () => mockUikit.delete(listener) };
  },
}));
// The bridge's window size, frozen in portrait: after the blip it never re-emits.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

import { OrientationProvider } from '@/lib/device/orientation';
import { en as locale } from '@/locales/en';
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

describe("a portrait lock that lands after the table's own (#1378)", () => {
  beforeEach(() => {
    jest.mocked(ScreenOrientation.lockAsync).mockClear();
  });

  const measure = (width: number, height: number) =>
    fireEvent(screen.getByTestId('orientation-root'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
  const covered = () => screen.queryAllByLabelText(locale['gameTable.rotateA11yLabel']).length > 0;

  it('asks for landscape again, and drops the cover once the window measures landscape', async () => {
    const nav = fakeScreen();
    const view = await render(<OrientationProvider>{table(nav.navigation)}</OrientationProvider>);
    await measure(844, 390);
    const settled = landscapeLocks();

    await measure(390, 844);
    expect(landscapeLocks()).toBe(settled + 1);
    expect(covered()).toBe(true);

    await nav.emit('transitionEnd', false);
    await measure(844, 390);
    expect(covered()).toBe(false);
    await view.unmount();
  });

  const { Orientation } = ScreenOrientation;
  const report = (orientation: number) =>
    act(() => mockUikit.forEach((l) => l({ orientationInfo: { orientation } })));

  (Platform.OS === 'ios' ? it : it.skip)(
    "on iOS follows UIKit, so a stale portrait measurement cannot hold the cover",
    async () => {
      const view = await render(<OrientationProvider>{table(undefined)}</OrientationProvider>);
      await measure(390, 844);
      expect(covered()).toBe(true);
      const settled = landscapeLocks();

      await report(Orientation.PORTRAIT_UP);
      await report(Orientation.PORTRAIT_UP);
      expect(landscapeLocks()).toBe(settled + 2);

      await report(Orientation.LANDSCAPE_RIGHT);
      expect(covered()).toBe(false);
      await view.unmount();
    }
  );
});
