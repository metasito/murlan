import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Card, GameState, Rank } from '@/lib/game/gameEngine';
import { stillSelection, storeOf } from './tapHelpers';
import { state } from '../support/game';
import { renderApp } from './harness/renderApp';
import { wire } from './harness/wire';

// CardView asks lib/cosmetics which back to draw exactly once per render, and
// it asks before any branch, so counting that call counts renders of every card
// on the table. Prefixed `mock` because jest hoists the factory above it.
const mockCardRenders = { n: 0 };
jest.mock('@/lib/cosmetics', () => {
  const actual = jest.requireActual('@/lib/cosmetics') as typeof import('@/lib/cosmetics');
  return {
    ...actual,
    useCardBackId: () => {
      mockCardRenders.n += 1;
      return actual.useCardBackId();
    },
  };
});

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

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

const SELECTION = stillSelection();
let store = storeOf();
const view = (cards: Card[], onActivate: (id: string) => void) => (
  <StraightHand
    cards={cards}
    store={store}
    selection={SELECTION}
    onActivate={onActivate}
    disabled={false}
    availW={600}
    roomW={456}
  />
);

const mount = (ui: React.ReactElement) => renderApp(ui, { user: { id: 'u1', username: 'Ana' } });

describe('the hand is not rebuilt by a render that changes nothing about it', () => {
  beforeEach(() => {
    mockCardRenders.n = 0;
    store = storeOf();
  });

  it('re-rendering with a fresh array of the same cards commits no card render', async () => {
    const r = await mount(view(hand(), noop));
    const afterMount = mockCardRenders.n;
    expect(afterMount).toBe(RANKS.length);

    await r.rerender(view(hand(), noop));
    expect(mockCardRenders.n).toBe(afterMount);
  });

  // The other half of the claim: the memo must not be swallowing real updates.
  it('selecting a card re-renders that card alone', async () => {
    await mount(view(hand(), noop));
    mockCardRenders.n = 0;

    await act(async () => store.set({ mode: 'play', ids: ['5_spades'], held: [] }));
    expect(mockCardRenders.n).toBe(1);
  });

  // The reason GameTable stabilizes handleCardPress with useCallback: a fresh
  // arrow per render defeats every comparator below it.
  it('a new onActivate reference rebuilds every card', async () => {
    const r = await mount(view(hand(), noop));
    mockCardRenders.n = 0;

    await r.rerender(view(hand(), () => {}));
    expect(mockCardRenders.n).toBe(RANKS.length);
  });
});

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const dealt = (cards: Card[]): GameState => state({
  players: [
    { id: 'u1', name: 'Ana', hand: cards, type: 'human' },
    { id: 'u2', name: 'Besi', hand: [], type: 'human' },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  lastMove: { seq: 0, kind: 'deal' },
});

const screenView = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);

// The comparators above only hold if what reaches them holds still. This drives
// the real screen and the real table, so a per-render arrow anywhere on the
// path from the screen to a card shows up here as a full rebuild.
describe('an incoming game:state does not rebuild the online hand', () => {
  beforeEach(() => {
    mockCardRenders.n = 0;
  });

  it('commits no card render for a state that changes neither the hand nor the selection', async () => {
    const r = await renderApp(screenView(), { user: { id: 'u1', username: 'Ana' }, online: true, connected: true });
    await r.socket().deliver('game:state', wire(dealt(hand()), 0), () => {});
    const afterMount = mockCardRenders.n;
    expect(afterMount).toBeGreaterThanOrEqual(RANKS.length);

    await r.socket().deliver('game:state', wire(dealt(hand()), 0), () => {});
    expect(mockCardRenders.n).toBe(afterMount);

    await r.unmount();
  });
});

// A hand-rolled comparator that skips a prop makes the card ignore it for the rest of the hand, so
// the real one is driven prop by prop. The props come out of the source: adding one fails here,
// naming it, instead of being skipped.
describe('cardItemPropsEqual compares every prop it is given', () => {
  const { cardItemPropsEqual } = require('@/components/table/hand') as typeof import('@/components/table/hand');
  const { readFileSync } = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const source = readFileSync(path.join(__dirname, '..', '..', 'components', 'table', 'hand.tsx'), 'utf8');
  const declared = /^interface CardItemProps \{\n([\s\S]*?)^\}$/m.exec(source)![1];
  const keys = [...declared.matchAll(/^ {2}([a-zA-Z0-9]+)\??:/gm)].map((m) => m[1]);

  const A = { id: '3_spades', rank: '3', suit: 'spades' };
  const B = { id: '4_hearts', rank: '4', suit: 'hearts' };
  const fn = () => {};
  const PLACE = { left: 0, bottom: 0, rot: 0, shift: 0, hitW: 40, restX: 0, restY: 0 };
  const SIZE = { scale: 1, w: 64, h: 90, reach: 1, restH: 90 };
  const DEAL = { kind: 'deal', clock: { value: 0 }, leaveMs: 0, from: { dx: 0, dy: 0 }, onDealt: fn };
  const PAIRS: Record<string, [unknown, unknown]> = {
    card: [A, B],
    store: [{ get: fn }, { get: fn }],
    place: [PLACE, { ...PLACE, shift: 24 }],
    size: [SIZE, { ...SIZE, w: 92 }],
    entry: [DEAL, null],
    onActivate: [fn, () => {}],
    shown: [{ value: [] }, { value: [] }],
    pressed: [{ value: null }, { value: null }],
    disabled: [false, true],
    zIndex: [0, 10],
    faceDown: [false, true],
    giveable: [false, true],
    hint: ['give this card', 'play this card'],
    isStartCard: [false, true],
    a11yActions: [[{ name: 'left' }], [{ name: 'right' }]],
    onMove: [fn, () => {}],
    onDrawn: [fn, () => {}],
    received: [false, true],
    hidden: [{ value: [] }, { value: [] }],
    rects: [{ place: { x: 0 } }, { place: { x: 0 } }],
  };
  const equal = cardItemPropsEqual as (a: object, b: object) => boolean;
  const base = Object.fromEntries(keys.map((k) => [k, PAIRS[k]?.[0]]));

  it('has a value pair for every declared prop, and read the props out of the source', () => {
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => !PAIRS[k])).toEqual([]);
  });

  it('says two identical prop sets are identical', () => {
    expect(equal(base, { ...base })).toBe(true);
  });

  it.each(keys.filter((k) => k !== 'entry'))('notices a change to %s', (key) => {
    expect(equal(base, { ...base, [key]: PAIRS[key][1] })).toBe(false);
  });

  it('compares the card by id, and the place and size by value', () => {
    expect(equal(base, { ...base, card: { ...A } })).toBe(true);
    expect(equal(base, { ...base, place: { ...PLACE }, size: { ...SIZE } })).toBe(true);
  });

  // A card reads how it enters once, at mount: one that noticed the deal disarm would restart mid-flight.
  it.each([
    ['the deal disarmed', null],
    ['a descent instead', { kind: 'descend', from: { dx: 0, dy: 0 } }],
    ['another clock', { ...DEAL, clock: { value: 0 } }],
    ['another leave', { ...DEAL, leaveMs: 120 }],
    ['another origin', { ...DEAL, from: { dx: 5, dy: 5 } }],
    ['another landing callback', { ...DEAL, onDealt: () => {} }],
  ])('ignores the entry: %s', (_, entry) => {
    expect(equal(base, { ...base, entry })).toBe(true);
  });

  it('still notices every other prop beside a changed entry', () => {
    expect(equal(base, { ...base, entry: null, place: { ...PLACE, shift: 24 } })).toBe(false);
  });
});
