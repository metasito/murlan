// tests/native/seatFanDeparting.test.tsx — a thrown combination leaves the
// seat it came from, not the badge.
//
// docs/adr/0002-a-play-leaves-the-seat-it-was-thrown-from.md derives the
// throwing seat's displayed count and departing backs from two things:
// `displayedHandCount` (the arithmetic, pinned in tests/gameTableModel.test.ts)
// and `departing` actually reaching the seat during a flight, held until the
// throw lands rather than until FlyingCards' own onDone. Node counting and
// text are both visible to react-test-renderer, so this belongs here rather
// than in tests/e2e/, which is reserved for the origin itself.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
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

// Real timing, not the reduced-motion shortcut other suites use: the whole
// point here is the boundary between the throw and its landing.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { GameTable } from '@/components/GameTable';
import { impactDelayMs } from '@/components/gameTableModel';
import type { Card, Combination, GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const NAMES = ['Ana', 'Besi', 'Cimi', 'Drin'];
const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({ id, rank, suit, isJoker: false });
const handOf = (seatIdx: number, n: number): Card[] =>
  Array.from({ length: n }, (_, i) => card(`s${seatIdx}_${i}`, '3', 'spades'));

const seat = (i: number, handSize: number): Player => ({
  id: `player_${i}`,
  name: NAMES[i],
  hand: handOf(i, handSize),
  type: 'human',
});

const noop = () => {};
const table = (gameState: GameState) => (
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
    />
  </SafeAreaProvider>
);

// viewerSeat 0, 4 players: seat 3 renders as the "left" opponent
// (components/gameTableModel.ts getOpponentPosition).
const LEFT_SEAT = 3;

const baseState = (players: Player[], combo: Combination): GameState => ({
  players,
  currentTurnIndex: 0,
  lastPlayedCombination: combo,
  lastPlayedBy: LEFT_SEAT,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

describe("a throwing seat's held count and departing backs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds the pre-play count and steps down at the landing, not at the flight\'s end', async () => {
    // Post-play hand is 2; the triple just thrown carries the other 2 the
    // seat held a moment ago, so the pre-play total is 4.
    const players = Array.from({ length: 4 }, (_, i) => seat(i, 4));
    players[LEFT_SEAT] = { ...players[LEFT_SEAT], hand: handOf(LEFT_SEAT, 2) };
    const combo: Combination = {
      type: 'pair',
      cards: [card('t0', '3', 'spades'), card('t1', '3', 'clubs')],
      strength: 3,
    };
    await render(table(baseState(players, combo)));

    const leftSeat = () => screen.getByTestId('side-seat-left');
    expect(within(leftSeat()).getByText('4')).toBeTruthy();

    // Just past the landing (impactDelayMs), well before FlyingCards' own
    // onDone fires from the settle spring a few hundred ms later.
    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 10);
    });
    expect(within(leftSeat()).getByText('2')).toBeTruthy();
  });

  it('draws exactly the cards freed up by the play, honestly, once the seat sits at its fan\'s cap', async () => {
    // FAN_DRAWN_CARDS.left is 5; an 8-card pre-play total (5 post-play + 3 in
    // flight) never had more than 5 backs drawn, so nothing should read as
    // departing — the old bug drew 3 departing and only 2 remaining instead.
    const players = Array.from({ length: 4 }, (_, i) => seat(i, 8));
    players[LEFT_SEAT] = { ...players[LEFT_SEAT], hand: handOf(LEFT_SEAT, 5) };
    const combo: Combination = {
      type: 'triple',
      cards: [card('t0', '3', 'spades'), card('t1', '3', 'clubs'), card('t2', '3', 'hearts')],
      strength: 3,
    };
    await render(table(baseState(players, combo)));

    const leftSeat = () => screen.getByTestId('side-seat-left');
    expect(within(leftSeat()).queryAllByTestId('seat-back-departing')).toHaveLength(0);
    expect(within(leftSeat()).queryAllByTestId('seat-back')).toHaveLength(5);
  });
});
