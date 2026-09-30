// tests/native/tableCardShadows.test.tsx — no card view on the table carries a platform shadow: the
// felt draws them all (#1259 plan 4, task 12). Every card scope is seen, at rest, mid-throw, mid-deal and mid-exchange.
import { describe, it, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CardView } from '@/components/CardView';
import { GameTable } from '@/components/GameTable';
import { CARD_SCOPES } from '@/components/table/cardRects';
import { CardCastContext } from '@/components/table/feltReady';
import { dealCards, type Card, type GameState, type Player } from '@/lib/game/gameEngine';
import { cardShadow } from '@/lib/theme';
import { frames } from './helpers/exchangeLegs';
import { throwPair } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const SHADOW_PROPS = ['boxShadow', 'shadowOpacity', 'shadowRadius', 'elevation'];
const SCOPE_OF: [RegExp, string][] = [[/^hand-card-/, 'hand'], [/^seat-back$/, 'fan'], [/^(flying-card|pile-card)$/, 'pile'], [/^dealt-back$/, 'deal'], [/^exchange-(flier|joker)-/, 'leg']];
const HIDDEN = { includeHiddenElements: true };
const noop = () => {};
const seen = new Set<string>();

function scopeOf(node: TestInstance): string | null {
  for (let n: TestInstance | null = node; n; n = n.parent) {
    const hit = SCOPE_OF.find(([id]) => typeof n!.props.testID === 'string' && id.test(n!.props.testID));
    if (hit) return hit[1];
  }
  return null;
}

/** Every view a card view draws, from its root (the face's box sits in its pressable), and those carrying a platform shadow. */
function cardHosts() {
  const roots = [
    ...screen.queryAllByTestId('card-box', HIDDEN).map((n) => n.parent!.parent!),
    ...screen.queryAllByTestId('card-box-back', HIDDEN).map((n) => n.parent!),
  ];
  const hosts = roots.flatMap((root) => {
    const scope = scopeOf(root);
    if (scope) seen.add(scope);
    return [root, ...root.queryAll(() => true)];
  });
  const shadowed = hosts.filter((n) => SHADOW_PROPS.some((p) => (StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>) ?? {})[p as keyof ViewStyle] !== undefined));
  return { cards: roots.length, shadowed };
}

function expectNoCardShadow() {
  const { cards, shadowed } = cardHosts();
  expect(cards).toBeGreaterThan(0);
  expect(shadowed.map((n) => StyleSheet.flatten(n.props.style))).toEqual([]);
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

describe('a card view on the table', () => {
  it('carries no shadow in the hand, the fans or a throw, in the air and at rest', async () => {
    const view = await throwPair(3);
    await frames(96);
    expect(screen.queryAllByTestId('flying-card', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    expectNoCardShadow();
    await frames(2000);
    expectNoCardShadow();
    await view.unmount();
  }, 120_000);

  it('carries none however many cards are held', async () => {
    const hands = dealCards(4).hands;
    const counts: number[] = [];
    for (const held of [13, 3]) {
      const view = await render(table(base(hands.map((h, i) => seat(i, h.slice(0, held))))));
      await frames(64);
      counts.push(cardHosts().shadowed.length);
      await view.unmount();
    }
    expect(counts).toEqual([0, 0]);
  }, 120_000);

  it('carries none on a dealt back in the air', async () => {
    const hands = dealCards(4).hands;
    const view = await render(table({ ...base(hands.map((h, i) => seat(i, h))), firstPlayMade: false }));
    let flying = 0;
    await frames(1600, () => {
      flying = Math.max(flying, screen.queryAllByTestId('dealt-back', { includeHiddenElements: true }).length);
      expectNoCardShadow();
    });
    expect(flying).toBeGreaterThan(0);
    await view.unmount();
  }, 120_000);

  it('carries none on a traded card in the air', async () => {
    const state: GameState = {
      ...base([seat(0, [card('5', 'hearts'), card('K', 'diamonds'), card('2', 'spades')]), seat(1, [card('4', 'clubs')]), seat(2, [card('6', 'hearts')])]),
      exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), bothJokersException: false },
    };
    const view = await render(table(state));
    await frames(3000, expectNoCardShadow);
    expect(seen.has('leg')).toBe(true);
    await view.unmount();
  }, 120_000);
});

describe('a card view off the felt', () => {
  it("keeps today's static shadow, its cast moved where the web felt is still baking", async () => {
    const face = card('7', 'clubs');
    const off = await render(<CardView card={face} />);
    expect(StyleSheet.flatten(screen.getByTestId('card-box').props.style).boxShadow).toBe(cardShadow('face').boxShadow);
    await off.unmount();
    const baking = await render(
      <CardCastContext.Provider value={{ x: -3, y: 7 }}>
        <CardView card={face} />
      </CardCastContext.Provider>
    );
    expect(StyleSheet.flatten(screen.getByTestId('card-box').props.style).boxShadow).toBe(cardShadow('face', { x: -3, y: 7 }).boxShadow);
    expect(cardShadow('face', { x: -3, y: 7 }).boxShadow).toContain('-3px 7px');
    await baking.unmount();
  });
});
