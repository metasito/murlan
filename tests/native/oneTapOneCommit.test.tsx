// tests/native/oneTapOneCommit.test.tsx — a tap on a hand card is one React commit, and in it only
// the card and the leaves that show the selection render.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React, { Profiler } from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cardSpokenName } from '@/lib/cardNames';
import { t, tn } from '@/lib/i18n';
import { handLabel } from '@/components/table/spokenLabels';
import { choiceOpensAt } from '@/lib/game/exchangeTimeline';
import * as engine from '@/lib/game/gameEngine';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { GameProvider } from '@/context/GameContext';
import { useLocalSession } from '@/context/gameHooks';
import { NotificationProvider } from '@/context/NotificationContext';
import { activate, gesturesOf, type Captured } from './tapHelpers';

const ZERO = { card: 0, hand: 0, seat: 0, pile: 0, table: 0, home: 0, writes: 0 };
const mockCount = { ...ZERO };

jest.mock('@/components/table/hand', () => {
  const actual = jest.requireActual('@/components/table/hand') as typeof import('@/components/table/hand');
  return {
    ...actual,
    StraightHand: (p: Parameters<typeof actual.StraightHand>[0]) => {
      mockCount.hand += 1;
      return actual.StraightHand(p);
    },
  };
});

jest.mock('@/components/table/selection', () => {
  const actual = jest.requireActual('@/components/table/selection') as typeof import('@/components/table/selection');
  return {
    ...actual,
    createSelectionStore: (...a: Parameters<typeof actual.createSelectionStore>) => {
      const store = actual.createSelectionStore(...a);
      return {
        ...store,
        set: (next: Parameters<typeof store.set>[0]) => {
          mockCount.writes += 1;
          store.set(next);
        },
      };
    },
  };
});

jest.mock('@/lib/cosmetics', () => {
  const actual = jest.requireActual('@/lib/cosmetics') as typeof import('@/lib/cosmetics');
  return {
    ...actual,
    useCardBack: () => {
      mockCount.card += 1;
      return actual.useCardBack();
    },
  };
});

jest.mock('@/components/table/seats', () => {
  const R = jest.requireActual('react') as typeof React;
  const actual = jest.requireActual('@/components/table/seats') as Record<string, React.ComponentType<object>>;
  const counted = (C: React.ComponentType<object>) => (p: object) => {
    mockCount.seat += 1;
    return R.createElement(C, p);
  };
  return { ...actual, TopOppSlot: counted(actual.TopOppSlot), SideOppSlot: counted(actual.SideOppSlot) };
});

jest.mock('@/components/table/pile', () => {
  const R = jest.requireActual('react') as typeof React;
  const actual = jest.requireActual('@/components/table/pile') as Record<string, React.ComponentType<object>>;
  return {
    ...actual,
    PileLayer: (p: object) => {
      mockCount.pile += 1;
      return R.createElement(actual.PileLayer, p);
    },
  };
});

jest.mock('@/components/useTableFeedback', () => {
  const actual = jest.requireActual('@/components/useTableFeedback') as typeof import('@/components/useTableFeedback');
  return {
    ...actual,
    useTableFeedback: (...a: Parameters<typeof actual.useTableFeedback>) => {
      mockCount.table += 1;
      return actual.useTableFeedback(...a);
    },
  };
});

jest.mock('@/lib/game/gameEngine', () => {
  const actual = jest.requireActual<typeof import('@/lib/game/gameEngine')>('@/lib/game/gameEngine');
  return { ...actual, getAllValidPlays: jest.fn(actual.getAllValidPlays) };
});
const legalPlays = engine.getAllValidPlays as jest.MockedFunction<typeof engine.getAllValidPlays>;

const mockHeld: { on: boolean; queue: (() => void)[] } = { on: false, queue: [] };
jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as { scheduleOnRN: (...a: unknown[]) => void };
  return {
    ...actual,
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      if (mockHeld.on) mockHeld.queue.push(() => fn(...args));
      else actual.scheduleOnRN(fn, ...args);
    },
  };
});

const mockRow: { gesture: Parameters<typeof gesturesOf>[0] | null } = { gesture: null };
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler') as Record<string, unknown>;
  return {
    ...actual,
    GestureDetector: ({ gesture, children }: { gesture: { gestures?: { type: string }[] }; children: React.ReactNode }) => {
      if (gesture.gestures?.some((g) => g.type === 'TapGestureHandler')) mockRow.gesture = gesture as never;
      return children;
    },
  };
});

const { GameTable } = require('@/components/GameTable') as typeof import('@/components/GameTable');

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const HAND = [card('3', 'spades'), card('7', 'hearts'), card('9', 'clubs')];
const SEVEN = HAND[1];
const seat = (id: string, hand: Card[]): Player => ({ id, name: id, hand, type: 'human' });
const state: GameState = {
  players: [
    seat('player_0', HAND),
    seat('player_1', [card('K', 'spades')]),
    seat('player_2', [card('Q', 'spades')]),
    seat('player_3', [card('J', 'spades')]),
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: engine.buildCombination([card('5', 'diamonds')]),
  lastPlayedBy: 3,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};
const noop = () => {};

const countHome = () => void (mockCount.home += 1);
function Home({ onRender }: { onRender: () => void }) {
  useLocalSession();
  onRender();
  return null;
}

const FIVE = card('5', 'hearts');
const NINE = card('9', 'hearts');
const exchange: GameState = {
  ...state,
  players: [seat('player_0', [FIVE, NINE, card('K', 'diamonds'), card('A', 'spades')]), ...state.players.slice(1)],
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  firstPlayMade: false,
  exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), bothJokersException: false },
};

const commits = { n: 0 };
const table = (s = state) => (
  <Profiler id="table" onRender={() => void (commits.n += 1)}>
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <GameProvider>
          <Home onRender={countHome} />
          <GameTable gameState={s} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
        </GameProvider>
      </NotificationProvider>
    </SafeAreaProvider>
  </Profiler>
);

const step = async (ms: number) => {
  for (let at = 0; at < ms; at += 16) await act(async () => jest.advanceTimersByTime(16));
};
const selected = (c: Card) => screen.getByLabelText(cardSpokenName(c, t)).props.accessibilityState?.selected === true;
const call = (g: Captured, name: string, e: unknown) => (g.config[name] as (e: unknown, ok?: boolean) => void)(e, true);
const onStrip = (c: Card) => {
  const b = StyleSheet.flatten(screen.getByTestId(`hand-card-${c.id}`).props.style) as { left: number; bottom: number };
  const rowH = StyleSheet.flatten(screen.getByTestId('hand-row').props.style).height as number;
  return { x: b.left + 2, y: rowH - b.bottom - 1 };
};

const spokenHand = (cards: number, staged: number) => screen.getByLabelText(handLabel(cards, staged, tn));
const gioca = () => screen.getByTestId('btn-gioca').props.accessibilityLabel as string;

/** What one tap costs: every counter zeroed, the tap run, then the counters read. */
async function measure(tap: () => Promise<void>) {
  Object.assign(mockCount, ZERO);
  commits.n = 0;
  legalPlays.mockClear();
  await tap();
  return { commits: commits.n, ...mockCount, legalPlays: legalPlays.mock.calls.length };
}

// The hand row renders 0 times: no prop of it changes, and its one subscription (the held card) is false with nothing held.
const ONE_CARD = { ...ZERO, commits: 1, card: 1, writes: 1, legalPlays: 0 };

describe('one tap on a hand card', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.assign(mockCount, ZERO);
    commits.n = 0;
    mockHeld.on = false;
    mockHeld.queue.length = 0;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('from a finger, commits once and renders only that card', async () => {
    const view = await render(table());
    await step(3000);
    expect(selected(SEVEN)).toBe(false);
    const { writes, ...rendered } = mockCount;
    expect(writes).toBe(0);
    expect(Math.min(commits.n, ...Object.values(rendered))).toBeGreaterThan(0);
    expect(spokenHand(3, 0)).toBeTruthy();
    expect(gioca()).not.toBe(t('gameTable.playA11yValid'));
    const at = onStrip(SEVEN);
    const cost = await measure(async () => {
      mockHeld.on = true;
      const { tap } = gesturesOf(mockRow.gesture!);
      await act(async () => {
        call(tap, 'onBegin', at);
        call(tap, 'onActivate', at);
        call(tap, 'onFinalize', at);
      });
      mockHeld.on = false;
      await act(async () => mockHeld.queue.splice(0).forEach((run) => run()));
    });
    expect(cost).toEqual(ONE_CARD);
    expect(selected(SEVEN)).toBe(true);
    expect(spokenHand(3, 1)).toBeTruthy();
    expect(gioca()).toBe(t('gameTable.playA11yValid'));
    await view.unmount();
  });

  it("from a screen reader's activate, commits once and renders only that card", async () => {
    const view = await render(table());
    await step(3000);
    const cost = await measure(async () => {
      await act(async () => {
        await activate(screen.getByLabelText(cardSpokenName(SEVEN, t)));
      });
    });
    expect(cost).toEqual(ONE_CARD);
    expect(selected(SEVEN)).toBe(true);
    expect(spokenHand(3, 1)).toBeTruthy();
    expect(gioca()).toBe(t('gameTable.playA11yValid'));
    await view.unmount();
  });

  it("in the exchange, costs the picked card and, on a change of pick, the one it replaces", async () => {
    const view = await render(table(exchange));
    await step(choiceOpensAt(false) + 3000);
    const pick = (c: Card) =>
      measure(async () => {
        await act(async () => {
          await activate(screen.getAllByLabelText(cardSpokenName(c, t))[0]);
        });
      });
    const ready = (c: Card) => t('exchange.confirmA11yReady', { card: cardSpokenName(c, t), name: 'player_1' });

    expect(await pick(FIVE)).toEqual(ONE_CARD);
    expect(gioca()).toBe(ready(FIVE));
    expect(await pick(NINE)).toEqual({ ...ONE_CARD, card: 2 });
    expect(gioca()).toBe(ready(NINE));
    expect(selected(FIVE)).toBe(false);
    expect(spokenHand(4, 0)).toBeTruthy();
    await view.unmount();
  });
});
