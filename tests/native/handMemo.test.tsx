import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Card, GameState, Rank } from '@/lib/gameEngine';

// CardView asks lib/cosmetics which back to draw exactly once per render, and
// it asks before any branch, so counting that call counts renders of every card
// on the table. Prefixed `mock` because jest hoists the factory above it.
const mockCardRenders = { n: 0 };
jest.mock('@/lib/cosmetics', () => {
  const actual = jest.requireActual('@/lib/cosmetics') as typeof import('@/lib/cosmetics');
  return {
    ...actual,
    useCardBack: () => {
      mockCardRenders.n += 1;
      return actual.useCardBack();
    },
  };
});

// What `useOnlineGame()` returns, swapped between renders the way an incoming
// `game:state` swaps the context value.
const mockOnline: { value: unknown } = { value: null };

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

// Reached through lib/sounds; the native module has no JS implementation here.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' } }),
}));

jest.mock('@/context/OnlineGameContext', () => ({
  useOnlineGame: () => mockOnline.value,
}));

// The table's chrome is not what is under test; the callback path through it
// is. This keeps that path exactly as GameTable wires it — `onSelectCard`
// becomes the hand's `onPress` — and drops everything else.
jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const shared = require('@/components/table/hand') as typeof import('@/components/table/hand');
  return {
    GameTable: (props: {
      gameState: GameState;
      viewerSeat: number;
      selectedIds: string[];
      onSelectCard: (id: string) => void;
    }) =>
      react.createElement(shared.StraightHand, {
        cards: props.gameState.players[props.viewerSeat].hand,
        selectedIds: props.selectedIds,
        onPress: props.onSelectCard,
        disabled: false,
        availW: 600,
        roomW: 456,
      }),
  };
});

// Imported after the mock so the hand module picks it up.
const { StraightHand } = require('@/components/table/hand') as typeof import('@/components/table/hand');

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType })
  .default;

const RANKS: Rank[] = ['3', '4', '5', '6', '7'];

/**
 * A hand of fresh card objects. Every `game:state` is JSON off the socket, so
 * the client gets new objects for the same cards several times per move — the
 * case the memo comparators exist for.
 */
const hand = (): Card[] =>
  RANKS.map((rank) => ({ id: `${rank}_spades`, suit: 'spades', rank, isJoker: false }));

const noop = () => {};

const view = (cards: Card[], selectedIds: string[], onPress: (id: string) => void) => (
  <StraightHand
    cards={cards}
    selectedIds={selectedIds}
    onPress={onPress}
    disabled={false}
    availW={600}
    roomW={456}
  />
);

describe('the hand is not rebuilt by a render that changes nothing about it', () => {
  beforeEach(() => {
    mockCardRenders.n = 0;
  });

  it('re-rendering with a fresh array of the same cards commits no card render', async () => {
    const r = await render(view(hand(), [], noop));
    const afterMount = mockCardRenders.n;
    expect(afterMount).toBe(RANKS.length);

    await r.rerender(view(hand(), [], noop));
    expect(mockCardRenders.n).toBe(afterMount);
  });

  // The other half of the claim: the memo must not be swallowing real updates.
  it('selecting a card still re-renders it', async () => {
    const r = await render(view(hand(), [], noop));
    mockCardRenders.n = 0;

    await r.rerender(view(hand(), ['5_spades'], noop));
    expect(mockCardRenders.n).toBeGreaterThan(0);
  });

  // The reason GameTable stabilizes handleCardPress with useCallback: a fresh
  // arrow per render defeats every comparator below it.
  it('a new onPress reference rebuilds every card', async () => {
    const r = await render(view(hand(), [], noop));
    mockCardRenders.n = 0;

    await r.rerender(view(hand(), [], () => {}));
    expect(mockCardRenders.n).toBe(RANKS.length);
  });
});

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const state = (cards: Card[]): GameState => ({
  players: [
    { id: 'u1', name: 'Ana', hand: cards, type: 'human' },
    { id: 'u2', name: 'Besi', hand: [], type: 'human' },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
});

// The context value's own callbacks keep their identity across a state, as the
// provider's do, so the only reference this test can move is the screen's.
const CALLBACKS = {
  clearError: jest.fn(),
  playCards: jest.fn(),
  pass: jest.fn(),
  giveExchangeCard: jest.fn(),
  sendReaction: jest.fn(),
  leaveRoom: jest.fn(),
  voteRematch: jest.fn(),
  answerRematch: jest.fn(),
  acknowledgeExchange: jest.fn(),
  clearPlayerLeft: jest.fn(),
  clearRejoinFailed: jest.fn(),
};

const online = (cards: Card[]) => ({
  ...CALLBACKS,
  gameState: state(cards),
  mySeatIndex: 0,
  isSpectator: false,
  playerLeft: false,
  rejoinFailed: false,
  reconnectNotice: null,
  connected: true,
  error: null,
  entrySource: null,
  rematchVoteState: null,
  cumulativeScores: {},
  matchState: { target: 21, length: 'match', over: false, winners: [], isDraw: false, continues: false },
  rematchIntents: { yes: 0, total: 0, answers: {} },
  rematchPromptOpen: false,
  exchangeAnnouncing: false,
  exchangeAnnounceData: null,
});

const screenView = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);

// The comparators above only hold if what reaches them holds still. This drives
// the real screen, so a per-render arrow anywhere on the path from
// `onSelectCard` to a card's `onPress` shows up here as a full rebuild.
describe('an incoming game:state does not rebuild the online hand', () => {
  beforeEach(() => {
    mockCardRenders.n = 0;
  });

  it('commits no card render for a state that changes neither the hand nor the selection', async () => {
    mockOnline.value = online(hand());
    const r = await render(screenView());
    const afterMount = mockCardRenders.n;
    expect(afterMount).toBe(RANKS.length);

    mockOnline.value = online(hand());
    await r.rerender(screenView());
    expect(mockCardRenders.n).toBe(afterMount);

    await r.unmount();
  });
});
