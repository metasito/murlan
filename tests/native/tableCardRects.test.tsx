// tests/native/tableCardRects.test.tsx — the registry holds exactly the cards the table draws, each
// under its owner's scope, at rest, mid-throw, mid-deal and mid-exchange (#1259 plan 4, task 11).
import { describe, it, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

import { GameTable } from '@/components/GameTable';
import { CARD_SCOPES, type CardRects } from '@/components/table/cardRects';
import { dealCards, type Card, type GameState, type Player } from '@/lib/game/gameEngine';
import { frames } from './helpers/exchangeLegs';
import { PAIR, throwPair } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

const HIDDEN = { includeHiddenElements: true };
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};
const seen = new Set<string>();

const registry = (): CardRects => (globalThis as { murlanCardRects?: () => CardRects }).murlanCardRects?.() ?? {};
function scoped(scope: string): string[] {
  const keys = Object.keys(registry()).filter((k) => k.startsWith(`${scope}:`));
  if (keys.length > 0) seen.add(scope);
  return keys.sort();
}
const opacity = (node: Parameters<typeof getAnimatedStyle>[0]) => (getAnimatedStyle(node) as { opacity?: number }).opacity ?? 1;
const shown = (testID: string | RegExp) => screen.queryAllByTestId(testID, HIDDEN).filter((n) => opacity(n) > 0);
const handDrawn = () => shown(/^hand-card-/).map((n) => `hand:${String(n.props.testID).slice('hand-card-'.length)}`).sort();

function expectExactlyDrawn() {
  expect(scoped('hand')).toEqual(handDrawn());
  expect(scoped('fan')).toHaveLength(screen.queryAllByTestId('seat-back', HIDDEN).length);
  expect(scoped('deal')).toHaveLength(shown('dealt-back').length);
  expect(scoped('leg')).toHaveLength(shown(/^exchange-(flier|joker)-/).length);
  expect(Object.keys(registry()).every((k) => CARD_SCOPES.some((s) => k.startsWith(`${s}:`)))).toBe(true);
}

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={gameState} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
  </SafeAreaProvider>
);

const base = (players: Player[]): GameState => ({
  players,
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});
const seat = (i: number, hand: Card[]): Player => ({ id: `p${i}`, name: `P${i}`, hand, type: 'human' });
const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });

beforeAll(() => {
  process.env.EXPO_PUBLIC_E2E_FAST = '1';
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_E2E_FAST;
  expect([...seen].sort()).toEqual([...CARD_SCOPES].sort());
});
beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the table card registry', () => {
  it('holds the hand, the fans and a throw in the air, then the play at rest', async () => {
    const view = await throwPair(3);
    await frames(96);
    expect(screen.queryAllByTestId('flying-card', HIDDEN).length).toBeGreaterThan(0);
    expect(scoped('pile')).toEqual(['pile:a', 'pile:b']);
    expect(scoped('hand').length).toBeGreaterThan(0);
    expect(scoped('fan').length).toBeGreaterThan(0);
    expectExactlyDrawn();

    await frames(2000);
    expect(screen.queryAllByTestId('flying-card', HIDDEN)).toHaveLength(0);
    expect(scoped('pile')).toEqual(['pile:a', 'pile:b']);
    expectExactlyDrawn();

    await view.unmount();
    await frames(32);
    expect(registry()).toEqual({});
  }, 120_000);

  it('holds each dealt back only while it is in the air', async () => {
    const hands = dealCards(4).hands;
    const view = await render(table({ ...base(hands.map((h, i) => seat(i, h))), firstPlayMade: false }));
    let flew = 0;
    await frames(1600, () => {
      flew = Math.max(flew, scoped('deal').length);
      expectExactlyDrawn();
    });
    expect(flew).toBeGreaterThan(0);
    await view.unmount();
  }, 120_000);

  it('holds a traded card from the leg that lifts it to the leg that lands it', async () => {
    const state: GameState = {
      ...base([seat(0, [card('5', 'hearts'), card('K', 'diamonds'), card('2', 'spades')]), seat(1, [card('4', 'clubs')]), seat(2, [card('6', 'hearts')])]),
      exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), bothJokersException: false },
    };
    const view = await render(table(state));
    let flew = 0;
    await frames(3000, () => {
      flew = Math.max(flew, scoped('leg').length);
      expectExactlyDrawn();
    });
    expect(flew).toBeGreaterThan(0);
    await view.unmount();
  }, 120_000);

  it("lights the pile's cards through a flush's catch, and not through a play that leaves cards in hand", async () => {
    const hands = dealCards(4).hands;
    const peak: number[] = [];
    for (const emptied of [true, false]) {
      const players = hands.map((h, i) => seat(i, i === 3 && emptied ? [] : h));
      const view = await render(table({ ...base(players), lastPlayedCombination: PAIR, lastPlayedBy: 3 }));
      let lit = 0;
      await frames(3000, () => {
        lit = Math.max(lit, ...scoped('pile').map((k) => registry()[k].glow));
      });
      peak.push(lit);
      await view.unmount();
    }
    expect(peak[0]).toBeGreaterThan(0.5);
    expect(peak[1]).toBe(0);
  }, 120_000);
});
