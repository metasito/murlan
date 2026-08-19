// tests/native/passMarker.test.tsx — a pass is the most common act in the game
// and it moves nothing on the felt (UX-02).
//
// Two channels are under test, both keyed on the committed state rather than on
// the viewer's tap, so an opponent, a bot and the server moving for a seat all
// announce themselves the same way: the per-seat marker and the pass sound.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
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

// The flight collapses to a single timer, so nothing here waits on a spring.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { playCardPass } from '@/lib/sounds';
import { GameTable } from '@/components/GameTable';
import { TopOppSlot, SideOppSlot } from '@/components/table/seats';
import type { Card, Combination, GameState, Player } from '@/lib/gameEngine';
import { it as itLocale } from '@/locales/it';

const PASSED = itLocale['gameShared.passedLabel'];

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({
  id,
  rank,
  suit,
  isJoker: false,
});

const KING = card('K_hearts', 'K', 'hearts');

const single = (c: Card): Combination => ({ type: 'single', cards: [c], strength: 13 });

/** Every seat still holds cards, so none of them is stepped over as gone out. */
const seat = (i: number, name: string): Player => ({
  id: `player_${i}`,
  name,
  hand: [card(`3_${i}`, '3', 'spades'), card(`4_${i}`, '4', 'clubs')],
  type: 'human',
});

const NAMES = ['Ana', 'Besi', 'Cimi', 'Drin'];

const state = (count: number, over: Partial<GameState>): GameState => ({
  players: Array.from({ length: count }, (_, i) => seat(i, NAMES[i])),
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

const noop = () => {};

/**
 * The seats whose slot carries the chip, named. Cardinality alone would pass
 * with the chip on the wrong opponent, which is the one thing the marker must
 * never get wrong. Both slots lay the name and the badge row out in a single
 * column (components/table/seats.tsx), so the name's parent is the seat.
 */
const markedSeatNames = (): string[] =>
  NAMES.filter((name) => {
    const column = screen.queryByText(name)?.parent;
    return !!column && within(column).queryAllByText(PASSED).length > 0;
  });

const table = (gameState: GameState, onPass: () => void = noop) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={onPass}
      onQuit={noop}
      onExchangeGive={noop}
      roundLabel="Partita"
    />
  </SafeAreaProvider>
);

describe('the per-seat pass marker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks every seat that has answered the round, and no others', async () => {
    // Seat 0 led; turns run downward, so seats 3 and 2 have passed and seat 1
    // is the one still on the clock.
    const r = await render(
      table(
        state(4, {
          lastPlayedCombination: single(KING),
          lastPlayedBy: 0,
          currentTurnIndex: 1,
          passCount: 2,
        })
      )
    );
    expect(markedSeatNames()).toEqual(['Cimi', 'Drin']);
    await r.unmount();
  });

  it('marks nobody before the first answer', async () => {
    const r = await render(
      table(
        state(4, {
          lastPlayedCombination: single(KING),
          lastPlayedBy: 0,
          currentTurnIndex: 3,
          passCount: 0,
        })
      )
    );
    expect(screen.queryAllByText(PASSED)).toHaveLength(0);
    await r.unmount();
  });

  it('marks the seat that passed, not the seat still to answer', async () => {
    // Three seats: seat 1 renders on the right, seat 2 on top. Seat 2 passed.
    const r = await render(
      table(
        state(3, {
          lastPlayedCombination: single(KING),
          lastPlayedBy: 0,
          currentTurnIndex: 1,
          passCount: 1,
        })
      )
    );
    expect(markedSeatNames()).toEqual(['Cimi']);
    await r.unmount();
  });

  it('clears every marker when the round closes', async () => {
    const r = await render(
      table(
        state(4, {
          lastPlayedCombination: single(KING),
          lastPlayedBy: 0,
          currentTurnIndex: 1,
          passCount: 2,
        })
      )
    );
    expect(markedSeatNames()).toEqual(['Cimi', 'Drin']);

    await act(async () => {
      r.rerender(
        table(
          state(4, {
            lastPlayedCombination: null,
            lastPlayedBy: 0,
            currentTurnIndex: 0,
            roundWinner: 0,
            passCount: 0,
          })
        )
      );
    });
    expect(screen.queryAllByText(PASSED)).toHaveLength(0);
    await r.unmount();
  });

  it('is rendered by the slot itself only when the seat has passed', async () => {
    const top = await render(
      withSafeArea(<TopOppSlot player={seat(1, 'Besi')} isActive={false} cardCount={5} passed />)
    );
    expect(top.queryByText(PASSED)).toBeTruthy();
    await top.unmount();

    const topClear = await render(
      withSafeArea(<TopOppSlot player={seat(1, 'Besi')} isActive={false} cardCount={5} />)
    );
    expect(topClear.queryByText(PASSED)).toBeNull();
    await topClear.unmount();

    const side = await render(
      withSafeArea(
        <SideOppSlot player={seat(2, 'Cimi')} isActive={false} side="left" cardCount={5} passed />
      )
    );
    expect(side.queryByText(PASSED)).toBeTruthy();
    await side.unmount();

    const sideClear = await render(
      withSafeArea(
        <SideOppSlot player={seat(2, 'Cimi')} isActive={false} side="right" cardCount={5} />
      )
    );
    expect(sideClear.queryByText(PASSED)).toBeNull();
    await sideClear.unmount();
  });
});

describe('the pass sound', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const LED = state(4, {
    lastPlayedCombination: single(KING),
    lastPlayedBy: 0,
    currentTurnIndex: 3,
    passCount: 0,
  });

  it('fires for a seat that is not the viewer', async () => {
    const r = await render(table(LED));
    expect(playCardPass).not.toHaveBeenCalled();

    await act(async () => {
      r.rerender(
        table(
          state(4, {
            lastPlayedCombination: single(KING),
            lastPlayedBy: 0,
            currentTurnIndex: 2,
            passCount: 1,
          })
        )
      );
    });
    expect(playCardPass).toHaveBeenCalledTimes(1);
    await r.unmount();
  });

  it('does not fire twice for the viewer’s own tap', async () => {
    // Tapping PASSA reports the intent; the sound belongs to the state that
    // comes back from it, which is what the next commit carries.
    const onPass = jest.fn();
    const mine = state(4, {
      lastPlayedCombination: single(KING),
      lastPlayedBy: 1,
      currentTurnIndex: 0,
      passCount: 0,
    });
    const r = await render(table(mine, onPass));

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-passa'));
    });
    expect(onPass).toHaveBeenCalledTimes(1);
    expect(playCardPass).not.toHaveBeenCalled();

    await act(async () => {
      r.rerender(
        table(
          state(4, {
            lastPlayedCombination: single(KING),
            lastPlayedBy: 1,
            currentTurnIndex: 3,
            passCount: 1,
          }),
          onPass
        )
      );
    });
    expect(playCardPass).toHaveBeenCalledTimes(1);
    await r.unmount();
  });

  it('fires for the pass that closes the round, which raises no count edge', async () => {
    // `processPass` resets passCount to zero on the pass that closes a round,
    // so the close itself is the edge. It layers under the round-winner sting.
    const r = await render(
      table(
        state(4, {
          lastPlayedCombination: single(KING),
          lastPlayedBy: 0,
          currentTurnIndex: 1,
          passCount: 2,
        })
      )
    );
    jest.mocked(playCardPass).mockClear();

    await act(async () => {
      r.rerender(
        table(
          state(4, {
            lastPlayedCombination: null,
            lastPlayedBy: 0,
            currentTurnIndex: 0,
            roundWinner: 0,
            passCount: 0,
          })
        )
      );
    });
    expect(playCardPass).toHaveBeenCalledTimes(1);
    await r.unmount();
  });

  it('heads-up: the viewer’s own pass closes the round and still sounds', async () => {
    // Two seats means `passesNeeded` is 1, so every legal pass closes the
    // round — this is the only pass a two-player game ever has.
    const onPass = jest.fn();
    const r = await render(
      table(
        state(2, {
          lastPlayedCombination: single(KING),
          lastPlayedBy: 1,
          currentTurnIndex: 0,
          passCount: 0,
        }),
        onPass
      )
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-passa'));
    });
    expect(onPass).toHaveBeenCalledTimes(1);
    expect(playCardPass).not.toHaveBeenCalled();

    await act(async () => {
      r.rerender(
        table(
          state(2, {
            lastPlayedCombination: null,
            lastPlayedBy: 1,
            currentTurnIndex: 1,
            roundWinner: 1,
            passCount: 0,
          }),
          onPass
        )
      );
    });
    expect(playCardPass).toHaveBeenCalledTimes(1);
    await r.unmount();
  });
});
