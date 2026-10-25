// tests/native/exchangeHoldsTheTurn.test.tsx — the table waits for the exchange.
//
// The exchange closes its own phase the moment the card is chosen, so
// `exchangePhase` is already settled while the two cards are still
// crossing the felt. A turn loop reading only the phase starts a bot's
// "thinking" timer over the top of the ceremony every seat is watching.
//
// What is under test is the gate, not the clock: whether the bot ever moves the
// provider's table is the whole question.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';
import type { GameState } from '@/lib/game/gameEngine';
import { BOT_THINK_MS } from '@/lib/game/turnSchedule';
import { aThreePlayed, state } from '../support/game';
import { useGameTable } from '@/context/GameContext';
import { offlineSave, renderAppHook } from './harness/renderApp';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

type TableProps = { onExchangeReady?: () => void; onExchangeGive?: (cardId: string) => void; exchangeAnnouncement?: { visible: boolean; onDismiss: () => void } };
const mockTable: { props: TableProps } = { props: {} };

/** The bot is on move and the exchange has just resolved. */
const STATE: GameState = state({
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [], type: 'bot' },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
});

/** A bot won the last round and owes the human a card back. */
const CHOOSING: GameState = state({
  ...STATE,
  players: [
    { id: 'player_0', name: 'Ana', hand: [{ id: '4_clubs', suit: 'clubs', rank: '4', isJoker: false }], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [{ id: '6_clubs', suit: 'clubs', rank: '6', isJoker: false }], type: 'bot' },
  ],
  exchangePhase: { kind: 'open', winnerIdx: 1, loserIdx: 0, cardFromLoser: { id: '2_clubs', suit: 'clubs', rank: '2', isJoker: false } },
});

/** The human won the last round and owes the bot a card back; the bot, having lost, leads. */
const GIVING: GameState = state({
  ...STATE,
  players: [
    {
      id: 'player_0',
      name: 'Ana',
      hand: [
        { id: '4_clubs', suit: 'clubs', rank: '4', isJoker: false },
        { id: '2_clubs', suit: 'clubs', rank: '2', isJoker: false },
      ],
      type: 'human',
    },
    { id: 'player_1', name: 'Luan', hand: [{ id: '6_clubs', suit: 'clubs', rank: '6', isJoker: false }], type: 'bot' },
  ],
  exchangePhase: { kind: 'open', winnerIdx: 0, loserIdx: 1, cardFromLoser: { id: '2_clubs', suit: 'clubs', rank: '2', isJoker: false } },
});

// The table draws nothing here: every path under test is the screen's own
// effect, and a real table would bring the whole felt with it.
jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: TableProps) => {
      mockTable.props = props;
      return react.createElement(rn.View, { testID: 'table' });
    },
  };
});

import GameScreen from '@/app/game';

/** Comfortably past the bot's think, whatever it is set to (lib/game/turnSchedule.ts). */
const PAST_THE_THINK = 5_000;

/** The screen over `table` resumed; `moves()` counts the tables the provider has committed since. */
const mount = async (table: GameState) => {
  const seen: (GameState | null)[] = [];
  const view = await renderAppHook(() => useGameTable().gameState, {
    offline: offlineSave(table),
    wrap: (probe) => (
      <>
        {probe}
        <GameScreen />
      </>
    ),
  });
  const moves = () => {
    if (seen.at(-1) !== view.result.current) seen.push(view.result.current);
    return seen.length - 1;
  };
  moves();
  return { ...view, moves };
};

describe('a bot on move while the exchange is being announced', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // What the bot gives is the provider's (tests/native/offlineDriver.test.tsx); when is the table's.
  it('a bot winner gives once the table opens the choice and it has thought, not on a clock of its own', async () => {
    const view = await mount(CHOOSING);
    await act(async () => {
      jest.advanceTimersByTime(PAST_THE_THINK * 4);
    });
    expect(view.moves()).toBe(0);
    await act(async () => mockTable.props.onExchangeReady?.());
    await act(async () => {
      jest.advanceTimersByTime(BOT_THINK_MS - 1);
    });
    expect(view.moves()).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(view.moves()).toBe(1);
    expect(view.result.current?.exchangePhase?.kind).toBe('settled');
    await view.unmount();
  });

  it('does not play until the ceremony is over', async () => {
    const view = await mount(GIVING);
    await act(async () => mockTable.props.onExchangeGive?.('4_clubs'));
    expect(view.moves()).toBe(1);
    expect(mockTable.props.exchangeAnnouncement?.visible).toBe(true);
    expect(view.result.current?.players[view.result.current.currentTurnIndex].type).toBe('bot');

    await act(async () => {
      jest.advanceTimersByTime(PAST_THE_THINK);
    });
    // A move here is a card thrown over the ceremony every seat is watching.
    expect(view.moves()).toBe(1);

    await act(async () => mockTable.props.exchangeAnnouncement?.onDismiss());
    await act(async () => {
      jest.advanceTimersByTime(PAST_THE_THINK);
    });
    // …and none here is a table that never takes its turn back.
    expect(view.moves()).toBe(2);

    await view.unmount();
  });
});
