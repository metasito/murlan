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
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

jest.mock('@/lib/device/sounds', () => ({
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCombo: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playClockRunningOut: jest.fn(async () => {}),
  stopClockRunningOut: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playMancheWon: jest.fn(async () => {}),
  playMancheLost: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  holdSounds: jest.fn(() => () => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

const mockReduceMotion = { on: true };
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduceMotion.on,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { GameTable } from '@/components/GameTable';
import type { TurnTimerConfig } from '@/components/GameTable';
import { urgentThresholdSeconds } from '@/components/turnTimerUi';
import type { Card, Combination, GameState, Player } from '@/lib/game/gameEngine';

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

/**
 * Mounting the table schedules the sweep rather than drawing it, so counting
 * the clocks straight after `render` counts whatever the machine happened to
 * have reached. Running what the mount queued settles it the same way on any
 * machine.
 */
async function renderSettled(ui: React.ReactElement) {
  await render(ui);
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

describe("a seat's turn clock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    mockReduceMotion.on = true;
  });

  // The two states that must still sweep. Without them every assertion below
  // would also pass on a ring that is never drawn at all.
  it('sweeps for the seat on move once a combination is down', async () => {
    await renderSettled(table(state({ lastPlayedCombination: single(KING), lastPlayedBy: 0 }), OFFLINE_TIMER));
    expect(clocks()).toBe(1);
  });

  it('sweeps by turning its two halves, three quarters through the window', async () => {
    mockReduceMotion.on = false;
    await renderSettled(table(state({ lastPlayedCombination: single(KING), lastPlayedBy: 0 }), OFFLINE_TIMER));
    await act(async () => {
      jest.advanceTimersByTime((OFFLINE_TIMER.seconds * 1000 * 3) / 4);
    });
    const turn = (testID: string) => {
      const style = getAnimatedStyle(screen.getByTestId(testID)) as { transform: { rotate: string }[] };
      return parseFloat(style.transform[0].rotate);
    };
    expect(turn('seat-turn-clock-right')).toBeCloseTo(180, 0);
    // Settling the mount runs its pending timers, which moves the clock a little further.
    expect(turn('seat-turn-clock-left')).toBeGreaterThan(80);
    expect(turn('seat-turn-clock-left')).toBeLessThan(120);
  });

  const opacity = (testID: string) =>
    (getAnimatedStyle(screen.getByTestId(testID)) as { opacity: number }).opacity;
  const red = () => [opacity('seat-turn-clock-urgent-right'), opacity('seat-turn-clock-urgent-left')];
  const urgentAt = (OFFLINE_TIMER.seconds - urgentThresholdSeconds(OFFLINE_TIMER.seconds)) * 1000;

  it('turns red and pulses from the urgent threshold, not before', async () => {
    mockReduceMotion.on = false;
    await renderSettled(table(state({ lastPlayedCombination: single(KING), lastPlayedBy: 0 }), OFFLINE_TIMER));
    await act(async () => {
      jest.advanceTimersByTime(urgentAt - 1000);
    });
    expect(red()).toEqual([0, 0]);
    expect(opacity('seat-turn-clock')).toBe(1);
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      seen.push(opacity('seat-turn-clock'));
    }
    expect(red()).toEqual([1, 1]);
    expect(Math.min(...seen)).toBeLessThan(0.7);
  });

  it('turns red without pulsing under reduced motion', async () => {
    await renderSettled(table(state({ lastPlayedCombination: single(KING), lastPlayedBy: 0 }), OFFLINE_TIMER));
    await act(async () => {
      jest.advanceTimersByTime(urgentAt - 1000);
    });
    expect(red()).toEqual([0, 0]);
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      expect(opacity('seat-turn-clock')).toBe(1);
    }
    expect(red()).toEqual([1, 1]);
  });

  it('sweeps for another seat online after the viewer has gone out', async () => {
    const players = Array.from({ length: 4 }, (_, i) => seat(i));
    players[0] = { ...players[0], hand: [], finishPosition: 1 };
    await renderSettled(table(state({ players }), ONLINE_TIMER));
    expect(clocks()).toBe(1);
  });

  it('is dark offline while a seat leads a new round, where no deadline exists', async () => {
    await renderSettled(table(state({}), OFFLINE_TIMER));
    expect(clocks()).toBe(0);
  });

  it('is dark through the exchange', async () => {
    await renderSettled(
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
