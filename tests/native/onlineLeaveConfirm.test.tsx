// tests/native/onlineLeaveConfirm.test.tsx — the in-table Quit between rounds
// is one tap away from abandoning a scored match, so it asks; the results
// overlay's Leave, over a decided match, does not. Rendered rather than
// scanned: the dialog is wired by a prop, and a scan cannot tell a wired one
// from a defined one.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

import { en as locale } from '@/locales/en';
import { aThreePlayed, state } from '../support/game';
import { renderApp } from './harness/renderApp';
import { roundOver, wire } from './harness/wire';


jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const seat = (id: string, name: string): Player => ({
  id,
  name,
  hand: [] as Card[],
  type: 'human',
});

const finished: GameState = state({
  players: [seat('player_0', 'Alice'), seat('player_1', 'Carl')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: true,
  finishingOrder: ['player_0', 'player_1'],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
});

jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: {
      onQuit: () => void;
      matchActions?: { onHome: () => void };
      gameState: { roundOver: boolean };
      matchOver: boolean;
      overlays?: (v: object) => React.ReactNode;
    }) =>
      react.createElement(
        rn.View,
        null,
        react.createElement(rn.Pressable, { testID: 'table-quit', onPress: props.onQuit }),
        props.matchActions && props.gameState.roundOver && props.matchOver
          ? react.createElement(rn.Pressable, { testID: 'btn-home', onPress: props.matchActions.onHome })
          : null,
        props.overlays ? props.overlays({}) : null
      ),
  };
});

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType })
  .default;

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function overlayShown(matchOver: boolean) {
  const view = await mount(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OnlineGameScreen />
    </SafeAreaProvider>
  );
  await view.socket().deliver('game:state', wire(finished, 0), () => {});
  await view.socket().deliver(
    'game:round_over',
    roundOver(finished, { player_0: matchOver ? 21 : 3, player_1: 0 }, {
      matchOver,
      matchContinues: !matchOver,
      matchWinnerIds: matchOver ? ['player_0'] : [],
    })
  );
  view.socket().reset();
  await act(async () => {
    jest.advanceTimersByTime(GAME_OVER_DELAY_CEILING);
  });
  return view;
}

/** Comfortably past the match ending's settled board. */
const GAME_OVER_DELAY_CEILING = 10_000;

const mount = (ui: React.ReactElement) =>
  renderApp(ui, { user: { id: 'alice', username: 'Alice' }, online: true, connected: true });

const left = (view: Awaited<ReturnType<typeof mount>>) => view.socket().sentAs('room:leave').length;

describe('leaving between rounds, online', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks before abandoning a match that is still being scored', async () => {
    const view = await overlayShown(false);
    expect(view.queryByTestId('btn-home', { includeHiddenElements: true })).toBeNull();

    await fireEvent.press(view.getByTestId('table-quit'));
    expect(left(view)).toBe(0);
    expect(view.getByText(locale['onlineGame.quitConfirmTitle'])).toBeTruthy();

    await fireEvent.press(view.getByTestId('confirm-accept'));
    expect(left(view)).toBe(1);

    await view.unmount();
  });

  it('asks nothing once the match is decided', async () => {
    const view = await overlayShown(true);

    await fireEvent.press(view.getByTestId('btn-home', { includeHiddenElements: true }));
    expect(view.queryByText(locale['onlineGame.quitConfirmTitle'])).toBeNull();
    expect(left(view)).toBe(1);

    await view.unmount();
  });
});
