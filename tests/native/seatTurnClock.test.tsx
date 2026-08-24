// tests/native/seatTurnClock.test.tsx — a seat's rim only sweeps a window that
// is really armed.
//
// The ring is a display of the viewer's own chip, so the two have to answer one
// gate (`turnTimerActive`): asked about the seat the ring is drawn on, not the
// viewer, since a seat that is not the viewer's can still have a server
// deadline once the viewer is out.
//
// This is a tree question, not a layout one, so it belongs here rather than in
// tests/e2e/: whether the clock is rendered at all is visible to
// react-test-renderer, and the offline lead-a-round state lasts about a second
// on a real table.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/sounds', () => ({
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
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { GameTable } from '@/components/GameTable';
import type { TurnTimerConfig } from '@/components/GameTable';
import type { Card, Combination, GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({
  id,
  rank,
  suit,
  isJoker: false,
});

const KING = card('K_hearts', 'K', 'hearts');
const single = (c: Card): Combination => ({ type: 'single', cards: [c], strength: 13 });

const NAMES = ['Ana', 'Besi', 'Cimi', 'Drin'];

const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: NAMES[i],
  hand: [card(`3_${i}`, '3', 'spades'), card(`4_${i}`, '4', 'clubs')],
  type: 'human',
});

const state = (over: Partial<GameState>): GameState => ({
  players: Array.from({ length: 4 }, (_, i) => seat(i)),
  // A seat that is not the viewer's, so the ring under test is an opponent's.
  currentTurnIndex: 1,
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

const noop = () => {};

/** Offline: leading a round has no deadline, so `includeNewRound` is false. */
const OFFLINE_TIMER = { seconds: 30, includeNewRound: false };
/** Online: the server arms its window on every turn, leads included. */
const ONLINE_TIMER = { seconds: 30, includeNewRound: true };

const table = (gameState: GameState, turnTimer: TurnTimerConfig) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      turnTimer={turnTimer}
    />
  </SafeAreaProvider>
);

const clocks = () => screen.queryAllByTestId('seat-turn-clock').length;

describe("a seat's turn clock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // The two states that must still sweep. Without them every assertion below
  // would also pass on a ring that is never drawn at all.
  it('sweeps for the seat on move once a combination is down', async () => {
    await render(table(state({ lastPlayedCombination: single(KING), lastPlayedBy: 0 }), OFFLINE_TIMER));
    expect(clocks()).toBe(1);
  });

  it('sweeps for another seat online after the viewer has gone out', async () => {
    const players = Array.from({ length: 4 }, (_, i) => seat(i));
    players[0] = { ...players[0], hand: [], finishPosition: 1 };
    await render(table(state({ players }), ONLINE_TIMER));
    expect(clocks()).toBe(1);
  });

  it('is dark offline while a seat leads a new round, where no deadline exists', async () => {
    await render(table(state({}), OFFLINE_TIMER));
    expect(clocks()).toBe(0);
  });

  it('is dark through the exchange', async () => {
    await render(
      table(
        state({
          lastPlayedCombination: single(KING),
          lastPlayedBy: 0,
          exchangePhase: {
            active: true,
            winnerIdx: 1,
            loserIdx: 0,
            cardFromLoser: KING,
            bothJokersException: false,
          },
        }),
        ONLINE_TIMER
      )
    );
    expect(clocks()).toBe(0);
  });
});
