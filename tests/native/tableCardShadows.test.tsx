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
import { cardShadow, Shadow } from '@/lib/theme';
import { frames } from './helpers/exchangeLegs';
import { throwPair } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const SHADOW_PROPS = ['boxShadow', 'shadowOpacity', 'shadowRadius', 'elevation'];
const SCOPE_ID = /^card-(hand|fan|pile|deal|leg):/;
const noop = () => {};
const seen = new Set<string>();

function scopeOf(n: TestInstance): string | null {
  const hit = typeof n.props.nativeID === 'string' ? SCOPE_ID.exec(n.props.nativeID) : null;
  if (hit) return hit[1];
  return typeof n.props.testID === 'string' && n.props.testID.startsWith('hand-card-') ? 'hand' : null;
}

const styleOf = (n: TestInstance) => (StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
const isGlow = (n: TestInstance) => SHADOW_PROPS.every((p) => styleOf(n)[p] === Shadow.goldSoft[p]);

/** Every view in every card's scope, and those carrying a platform shadow, the gold glows apart. */
function cardHosts() {
  const scopes = screen.container.queryAll((n) => scopeOf(n) !== null);
  const hosts = new Set(scopes.flatMap((s) => (seen.add(scopeOf(s)!), [s, ...s.queryAll(() => true)])));
  const shadowed = [...hosts].filter((n) => SHADOW_PROPS.some((p) => styleOf(n)[p] !== undefined));
  return { scopes: scopes.length, shadowed: shadowed.filter((n) => !isGlow(n)), glows: shadowed.filter(isGlow) };
}

function expectNoCardShadow() {
  const { scopes, shadowed } = cardHosts();
  expect(scopes).toBeGreaterThan(0);
  expect(shadowed.map(styleOf)).toEqual([]);
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

  it('still carries its gold glow, one per held card, until task 13 draws it on the felt and this reads 0', async () => {
    const hands = dealCards(4).hands;
    const view = await render(table(base(hands.map((h, i) => seat(i, h)))));
    await frames(64);
    const { glows } = cardHosts();
    await view.unmount();
    expect(glows.length).toBe(hands[0].length);
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
