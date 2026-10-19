// tests/native/tableCards.test.tsx — every card the table draws is in the registry under its owner's scope,
// and no card view on the table carries a platform shadow (the felt draws them all), judged on the same
// frames at rest, mid-throw, mid-deal and mid-exchange (#1259 plan 4, tasks 11 and 12).
import { describe, it, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { getAnimatedStyle } from 'react-native-reanimated';

import { CardView } from '@/components/CardView';
import { CARD_SCOPES, type CardRects } from '@/components/table/cardRects';
import { CardCastContext } from '@/components/table/feltReady';
import { dealCards } from '@/lib/game/gameEngine';
import { CardShadow, cardShadow, Colors, Shadow, withAlpha } from '@/lib/theme';
import { card, seat, state } from '../support/game.ts';
import { cardScenarios, cardTable, dealtTable } from './helpers/cardScenarios';
import { frames } from './helpers/exchangeLegs';
import { PAIR } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

const HIDDEN = { includeHiddenElements: true };
const SHADOW_PROPS = ['boxShadow', 'shadowOpacity', 'shadowRadius', 'elevation'];
const SCOPE_ID = /^card-(hand|fan|pile|deal|leg):/;
const registered = new Set<string>();
const shadowJudged = new Set<string>();

const registry = (): CardRects => (globalThis as { murlanCardRects?: () => CardRects }).murlanCardRects?.() ?? {};
function scoped(scope: string): string[] {
  const keys = Object.keys(registry()).filter((k) => k.startsWith(`${scope}:`));
  if (keys.length > 0) registered.add(scope);
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

function scopeOf(n: TestInstance): string | null {
  const hit = typeof n.props.nativeID === 'string' ? SCOPE_ID.exec(n.props.nativeID) : null;
  if (hit) return hit[1];
  return typeof n.props.testID === 'string' && n.props.testID.startsWith('hand-card-') ? 'hand' : null;
}

const styleOf = (n: TestInstance) => (StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
const isGlow = (n: TestInstance) => SHADOW_PROPS.every((p) => styleOf(n)[p] === Shadow.cardGlow[p]);

/** Every view in every card's scope, and those carrying a platform shadow, the gold glows apart. */
function cardHosts() {
  const scopes = screen.container.queryAll((n) => scopeOf(n) !== null);
  const hosts = new Set(scopes.flatMap((s) => (shadowJudged.add(scopeOf(s)!), [s, ...s.queryAll(() => true)])));
  const shadowed = [...hosts].filter((n) => SHADOW_PROPS.some((p) => styleOf(n)[p] !== undefined));
  return { scopes: scopes.length, shadowed: shadowed.filter((n) => !isGlow(n)), glows: shadowed.filter(isGlow) };
}

function expectNoCardShadow() {
  const { scopes, shadowed } = cardHosts();
  expect(scopes).toBeGreaterThan(0);
  expect(shadowed.map(styleOf)).toEqual([]);
}

beforeAll(() => {
  process.env.EXPO_PUBLIC_E2E_FAST = '1';
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_E2E_FAST;
  expect([...registered].sort()).toEqual([...CARD_SCOPES].sort());
  expect([...shadowJudged].sort()).toEqual([...CARD_SCOPES].sort());
});
beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('a card on the table', () => {
  it.each(cardScenarios)('is registered exactly as drawn and casts no shadow of its own through $name', async (scenario) => {
    let peak = 0;
    await scenario.play((at) => {
      expectExactlyDrawn();
      expectNoCardShadow();
      peak = Math.max(peak, scoped(scenario.flying).length);
      if (at === 'frame') return;
      expect(scoped('pile')).toEqual(['pile:a', 'pile:b']);
      if (at === 'air') {
        expect(scoped('hand').length).toBeGreaterThan(0);
        expect(scoped('fan').length).toBeGreaterThan(0);
      }
    });
    expect(peak).toBeGreaterThan(0);
    await frames(32);
    expect(registry()).toEqual({});
  }, 120_000);

  it("lights the pile's cards through a going-out catch, and not through a play that leaves cards in hand", async () => {
    const hands = dealCards(4).hands;
    const peak: number[] = [];
    for (const emptied of [true, false]) {
      const players = hands.map((h, i) => seat(`p${i}`, i === 3 && emptied ? [] : h));
      const view = await render(cardTable(state(players, { firstPlayMade: true, lastPlayedCombination: PAIR, lastPlayedBy: 3 })));
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

  it('carries no shadow however many cards are held', async () => {
    const counts: number[] = [];
    for (const held of [13, 3]) {
      const dealt = dealtTable();
      const view = await render(cardTable({ ...dealt, players: dealt.players.map((p) => ({ ...p, hand: p.hand.slice(0, held) })) }));
      await frames(64);
      counts.push(cardHosts().shadowed.length);
      await view.unmount();
    }
    expect(counts).toEqual([0, 0]);
  }, 120_000);

  it('carries no gold glow on a held card: the felt draws it', async () => {
    const dealt = dealtTable();
    const view = await render(cardTable(dealt));
    await frames(64);
    const { glows } = cardHosts();
    const held = screen.queryAllByTestId(/^hand-card-/, HIDDEN).length;
    await view.unmount();
    expect(held).toBe(dealt.players[0].hand.length);
    expect(glows.length).toBe(0);
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

  it("casts a hand or pile card's shadow as the Skia card shade does where the web felt is still baking, and no other card's", async () => {
    const shade = `-3px 7px ${CardShadow.cast.blur}px ${withAlpha(Colors.shadow, CardShadow.cast.alpha)}`;
    const face = card('7', 'clubs');
    const shadowOf = async (rectKey: string, faceDown = false) => {
      const view = await render(
        <CardCastContext.Provider value={{ x: -3, y: 7 }}>
          <CardView card={face} rectKey={rectKey} faceDown={faceDown} />
        </CardCastContext.Provider>
      );
      const shadow = StyleSheet.flatten(screen.getByTestId(faceDown ? 'card-box-back' : 'card-box').props.style).boxShadow as string;
      await view.unmount();
      return shadow;
    };
    expect(await shadowOf(`hand:${face.id}`)).toContain(shade);
    expect(await shadowOf(`hand:${face.id}`, true)).toContain(shade);
    expect(await shadowOf(`pile:${face.id}`)).toContain(shade);
    expect(await shadowOf(`deal:${face.id}`)).toBe(cardShadow('face', { x: -3, y: 7 }).boxShadow);
    expect(await shadowOf(`deal:${face.id}`)).not.toContain(`${CardShadow.cast.blur}px`);
  });
});
