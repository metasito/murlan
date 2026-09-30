// tests/native/onlineMancheSelection.test.tsx — the online screen holds no selection; the table's
// own keeps what the server's answer leaves in the hand and drops the rest at the deal.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { activate } from './tapHelpers';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';

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
const NINE = card('9', 'spades');
const FOUR = card('4', 'diamonds');

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const stateWith = (hand: Card[], over: Partial<GameState> = {}): GameState => ({
  players: [seat('player_0', 'Ana', hand), seat('player_1', 'Besi', [card('4', 'clubs')])],
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

let mockGameState: GameState = stateWith([KING, NINE]);
const mockPlayCards = jest.fn<(ids: string[]) => void>();

jest.mock('@/context/OnlineGameContext', () =>
  (require('./onlineContextMock') as typeof import('./onlineContextMock')).onlineContextMock(
    () => ({
      gameState: mockGameState,
      mySeatIndex: 0,
      isSpectator: false,
      playerLeft: false,
      rejoinFailed: false,
      reconnectNotice: null,
      connected: true,
      error: null,
      clearError: () => {},
      playCards: mockPlayCards,
      pass: () => {},
      giveExchangeCard: () => {},
      sendReaction: () => {},
      leaveRoom: () => {},
      voteRematch: () => {},
      entrySource: 'lobby',
      rematchVoteState: null,
      cumulativeScores: {},
      handScores: {},
      matchState: { target: 21, length: 'match', over: false, winners: [] },
      rematchIntents: { yes: 0, total: 0, answers: {} },
      rematchPromptOpen: false,
      answerRematch: () => {},
      exchangeAnnouncing: false,
      exchangeAnnounceData: null,
      acknowledgeExchange: () => {},
      clearPlayerLeft: () => {},
      clearRejoinFailed: () => {},
    })
  )
);

import OnlineGameScreen from '@/app/(online)/game';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const screenUnderTest = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);

const cardNode = (c: Card) => screen.getByLabelText(cardSpokenName(c, t));
const selected = (c: Card) => cardNode(c).props.accessibilityState?.selected === true;
const tap = async (c: Card) => {
  await act(async () => {
    await activate(cardNode(c));
  });
};
const serverSends = async (r: Awaited<ReturnType<typeof render>>, next: GameState) => {
  mockGameState = next;
  await act(async () => r.rerender(screenUnderTest()));
};

describe('the online table selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGameState = stateWith([KING, NINE]);
  });

  it('is cleared by the deal, even one that deals the staged card back', async () => {
    const r = await render(screenUnderTest());
    await tap(KING);
    expect(selected(KING)).toBe(true);

    await serverSends(r, stateWith([KING, NINE], { gameOver: true, rankings: ['player_1'] }));
    expect(selected(KING)).toBe(true);

    await serverSends(r, stateWith([KING, NINE, FOUR], { firstPlayMade: false }));
    expect(selected(KING)).toBe(false);

    await r.unmount();
  });

  it('keeps a staged card the acknowledged play left in the hand', async () => {
    const r = await render(screenUnderTest());
    await tap(KING);
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(mockPlayCards).toHaveBeenCalledWith([KING.id]);
    await tap(NINE);

    await serverSends(
      r,
      stateWith([NINE], {
        currentTurnIndex: 1,
        lastPlayedCombination: { type: 'single', cards: [KING], strength: 11 },
        lastPlayedBy: 0,
      })
    );
    expect(selected(NINE)).toBe(true);

    await r.unmount();
  });

  it('survives GIOCA, and keeps all of it while the hand holds still, as on a rejected play', async () => {
    const r = await render(screenUnderTest());
    await tap(KING);
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    await serverSends(r, stateWith([card('K', 'hearts'), card('9', 'spades')]));
    expect(selected(KING)).toBe(true);
    expect(selected(NINE)).toBe(false);

    await r.unmount();
  });

  it('leaves a selection alone while the manche is still being played', async () => {
    const r = await render(screenUnderTest());
    await tap(KING);

    await serverSends(r, stateWith([KING, NINE], { currentTurnIndex: 1 }));
    expect(selected(KING)).toBe(true);

    await r.unmount();
  });
});
