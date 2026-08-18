// tests/native/onlineMancheSelection.test.tsx — a staged selection does not
// survive the deal (UX-01).
//
// Online the selection is cleared on a server acknowledgement and on the
// viewer's own pass, neither of which happens between manches. Card ids are
// deterministic (`${rank}_${suit}`), so an id staged in the hand that ended
// names a real card in the new one roughly one time in four — and the table's
// prune cannot help, because the hand genuinely holds it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/gameEngine';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' } }),
}));

const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

const KING = card('K', 'hearts');
/** Prefixed so the GameTable mock factory may close over it. */
const mockStagedId = KING.id;

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const stateWith = (over: Partial<GameState>): GameState => ({
  players: [
    seat('player_0', 'Ana', [KING, card('9', 'spades')]),
    seat('player_1', 'Besi', [card('4', 'clubs')]),
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  ...over,
});

// The screen owns `selectedIds`; the table is only where it is shown and
// changed. A stub for it keeps the test on the screen's own state machine.
let mockGameState: GameState = stateWith({});

jest.mock('@/context/OnlineGameContext', () => ({
  useOnlineGame: () => ({
    gameState: mockGameState,
    mySeatIndex: 0,
    isSpectator: false,
    playerLeft: false,
    rejoinFailed: false,
    reconnectNotice: null,
    connected: true,
    error: null,
    clearError: () => {},
    playCards: () => {},
    pass: () => {},
    giveExchangeCard: () => {},
    sendReaction: () => {},
    leaveRoom: () => {},
    voteRematch: () => {},
    entrySource: 'lobby',
    rematchVoteState: null,
    cumulativeScores: {},
    matchState: { target: 21, length: 'match', over: false },
    rematchIntents: { yes: 0, total: 0, answers: {} },
    rematchPromptOpen: false,
    answerRematch: () => {},
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    acknowledgeExchange: () => {},
    clearPlayerLeft: () => {},
    clearRejoinFailed: () => {},
  }),
}));

jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: {
      selectedIds: string[];
      onSelectCard: (id: string) => void;
    }) =>
      react.createElement(rn.View, null, [
        react.createElement(
          rn.Text,
          { testID: 'selection', key: 'sel' },
          props.selectedIds.join(',')
        ),
        react.createElement(
          rn.Pressable,
          { testID: 'stage', key: 'stage', onPress: () => props.onSelectCard(mockStagedId) },
          react.createElement(rn.Text, null, 'stage')
        ),
      ]),
  };
});

import OnlineGameScreen from '@/app/(online)/game';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const screenUnderTest = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);

const selection = () => screen.getByTestId('selection').props.children as string;

describe('the manche ending online', () => {
  beforeEach(() => {
    mockGameState = stateWith({});
  });

  it('clears a staged selection, so the new deal starts blank', async () => {
    const r = await render(screenUnderTest());

    await act(async () => {
      fireEvent.press(screen.getByTestId('stage'));
    });
    expect(selection()).toBe(KING.id);

    // The manche ends with the viewer's hand non-empty, so nothing prunes it.
    mockGameState = stateWith({ gameOver: true, rankings: ['player_1'] });
    await act(async () => r.rerender(screenUnderTest()));
    expect(selection()).toBe(KING.id);

    // The next manche is dealt, and it deals the same id back.
    mockGameState = stateWith({});
    await act(async () => r.rerender(screenUnderTest()));
    expect(selection()).toBe('');

    await r.unmount();
  });

  it('leaves a selection alone while the manche is still being played', async () => {
    const r = await render(screenUnderTest());

    await act(async () => {
      fireEvent.press(screen.getByTestId('stage'));
    });

    mockGameState = stateWith({ currentTurnIndex: 1 });
    await act(async () => r.rerender(screenUnderTest()));
    expect(selection()).toBe(KING.id);

    await r.unmount();
  });
});
