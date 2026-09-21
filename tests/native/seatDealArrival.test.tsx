// tests/native/seatDealArrival.test.tsx — an opponent's hand is dealt to it
// card by card, and its badge counts only what has landed (#1102).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/sounds', () => ({
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

let mockReduce = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduce,
  setMotionPreference: () => {},
  getMotionPreference: () => (mockReduce ? 'on' : 'off'),
}));

import { GameTable } from '@/components/GameTable';
import { DEAL_FLIGHT_MS, dealArrivalsMs, dealLeaveMs } from '@/components/flightPhysics';
import { motionMs } from '@/lib/theme';
import { playDeal } from '@/lib/sounds';
import type { Card, GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const NAMES = ['Ana', 'Besi', 'Cimi', 'Drin'];
const handOf = (seatIdx: number, n: number): Card[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${seatIdx}_${i}`, rank: '3', suit: 'spades', isJoker: false }) as Card);
const players: Player[] = NAMES.map((name, i) => ({ id: `player_${i}`, name, hand: handOf(i, 13), type: 'human' }));

const freshDeal: GameState = {
  players,
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
};

const noop = () => {};
const table = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={freshDeal}
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

// viewerSeat 0 of 4: seat 2 sits on top, the farthest from the pile; seat 3 on the left, nearer.
const TOP_SEAT = 2;
const LEFT_SEAT = 3;
const topSeat = () => within(screen.getByTestId('top-seat'));
const leftSeat = () => within(screen.getByTestId('side-seat-left'));

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("an opponent's hand arrives with the deal", () => {
  beforeEach(() => {
    mockReduce = false;
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts up at the seat as each card lands, and the deal waits for the table to settle', async () => {
    const r = await render(table());
    const entry = motionMs('reveal', false);
    const arrivals = dealArrivalsMs(13, TOP_SEAT, 4, entry, DEAL_FLIGHT_MS);

    expect(topSeat().queryByText('13')).toBeNull();
    expect(screen.getAllByTestId('dealt-back').length).toBe(39);
    expect(playDeal).not.toHaveBeenCalled();

    await advance(entry);
    expect(playDeal).toHaveBeenCalledTimes(1);

    await advance(arrivals[4] - entry);
    expect(topSeat().getByText('5')).toBeTruthy();

    await advance(arrivals[12] - arrivals[4]);
    expect(topSeat().getByText('13')).toBeTruthy();
    expect(screen.queryAllByTestId('dealt-back').length).toBe(0);

    await r.unmount();
  });

  it('deals to a nearer seat in less than a whole flight', async () => {
    const r = await render(table());
    const fifthLeaves = motionMs('reveal', false) + dealLeaveMs(4, LEFT_SEAT, 4);

    await advance(fifthLeaves + DEAL_FLIGHT_MS - 1);
    expect(Number(leftSeat().getByText(/^[0-9]+$/).props.children)).toBeGreaterThanOrEqual(5);

    await r.unmount();
  });

  it('seats every hand at once under reduced motion', async () => {
    mockReduce = true;
    const r = await render(table());

    expect(leftSeat().getByText('13')).toBeTruthy();
    expect(screen.queryAllByTestId('dealt-back').length).toBe(0);

    await r.unmount();
  });
});
