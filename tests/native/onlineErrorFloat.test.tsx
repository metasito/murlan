// tests/native/onlineErrorFloat.test.tsx — a server error on the online table is the table's own float,
// not a toast the screen paints over it.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { state } from '../support/game';
import { renderApp } from './harness/renderApp';
import { wire } from './harness/wire';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const ERROR = "You can't pass";
const seat = (id: string, name: string): Player => ({ id, name, hand: [] as Card[], type: 'human' });
const mockState: GameState = state({
  players: [seat('player_0', 'Alice'), seat('player_1', 'Carl')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  lastMove: { seq: 0, kind: 'deal' },
});

const mockTable = jest.fn();
jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: { error?: { text: string } | null; overlays?: (v: object) => React.ReactNode }) => {
      mockTable(props.error?.text);
      return react.createElement(rn.View, null, props.overlays ? props.overlays({}) : null);
    },
  };
});

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };

const mount = async (ui: React.ReactElement) => {
  const view = await renderApp(ui, { user: { id: 'alice', username: 'Alice' }, online: true, connected: true });
  await view.socket().deliver('game:state', wire(mockState, 0), () => {});
  // A code this bundle has no words for, so the server's own text is what the player reads.
  await view.socket().deliver('game:error', { code: 'NEWER_SERVER_REFUSAL', message: ERROR });
  return view;
};

describe('a server error on the online table', () => {
  it('goes to the table, and the screen paints none of its own', async () => {
    const view = await mount(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    expect(mockTable).toHaveBeenLastCalledWith(ERROR);
    expect(screen.queryByText(ERROR, { includeHiddenElements: true })).toBeNull();
    await view.unmount();
  });
});
