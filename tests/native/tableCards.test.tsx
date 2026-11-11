// tests/native/tableCards.test.tsx — every card the table draws is in the registry under its owner's scope,
// and no card view on the table carries a platform shadow but its own contact (the felt draws the casts), judged on the same
// frames at rest, mid-throw, mid-deal and mid-exchange (#1259 plan 4, tasks 11 and 12).
import { describe, it, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import React from 'react';
import { Platform, StyleSheet, type StyleProp, type View, type ViewStyle } from 'react-native';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { getAnimatedStyle } from './harness/animatedStyle';

import { CardView } from '@/components/CardView';
import { CARD_SCOPES, type CardRects } from '@/components/table/cardRects';
import { restingCast, shadowRect } from '@/components/table/cardShadows';
import { CardCastContext, useCardCast } from '@/components/table/feltReady';
import type { Pool } from '@/components/table/lampRig';
import { dealCards } from '@/lib/game/gameEngine';
import { CardShadow, cardContact, cardShadow, Colors, Shadow, TABLE_CAST, withAlpha } from '@/lib/theme';
import { card } from '../support/game.ts';
import { FLYING, THROW, cardTable, dealtTable, pairThrownBy3, runScenario, type Scenario } from './helpers/cardScenarios';
import { frames } from './helpers/exchangeLegs';
import { setWindow } from './harness/env';
import { bootFeedback } from './helpers/feedback';

jest.mock('@/lib/e2eConfig', () =>
  (require('./helpers/e2eBuildMock') as typeof import('./helpers/e2eBuildMock')).e2eConfigAsBuilt()
);

jest.mock('@/components/table/cardShadows', () => jest.requireActual('@/components/table/cardShadows'));

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

const feltScale = () => (globalThis as { murlanCardFelt?: () => { s: number } }).murlanCardFelt!().s;
/** A card's own contact at the table's scale, of its own kind (its sibling box's), the one shadow a card view on the felt carries. */
function isContact(n: TestInstance, scope: string): boolean {
  const style = styleOf(n);
  if (scope === 'fan' || n.props.testID !== 'card-contact' || SHADOW_PROPS.some((p) => p !== 'boxShadow' && style[p] !== undefined)) return false;
  const boxes = (n.parent?.children ?? []).filter((c): c is TestInstance => typeof c !== 'string' && /^card-box(-back)?$/.test(String(c.props.testID)));
  if (boxes.length !== 1) return false;
  const kind = boxes[0].props.testID === 'card-box-back' ? 'back' : 'face';
  return style.boxShadow === cardContact(kind, feltScale()).boxShadow;
}

describe('a card contact', () => {
  it("is the contact token's at the table's scale: half a point down times the scale, one point of blur times it, the kind's alpha", () => {
    expect(cardContact('face', 2).boxShadow).toBe(`0px 1px 2px ${withAlpha('#000000', 0.3)}`);
    expect(cardContact('back', 2).boxShadow).toBe(`0px 1px 2px ${withAlpha('#000000', 0.35)}`);
    expect(cardContact('face', 1.5).boxShadow).toBe(`0px 0.75px 1.5px ${withAlpha('#000000', 0.3)}`);
  });
});

/** Every view in every card's scope, and those carrying a platform shadow, the gold glows and contacts apart. */
function cardHosts() {
  const scopes = screen.container.queryAll((n) => scopeOf(n) !== null);
  const hosts = new Map(scopes.flatMap((s) => (shadowJudged.add(scopeOf(s)!), [s, ...s.queryAll(() => true)].map((n) => [n, scopeOf(s)!] as const))));
  const shadowed = [...hosts.keys()].filter((n) => SHADOW_PROPS.some((p) => styleOf(n)[p] !== undefined));
  const contacts = shadowed.filter((n) => isContact(n, hosts.get(n)!));
  return { scopes: scopes.length, shadowed: shadowed.filter((n) => !isGlow(n) && !contacts.includes(n)), glows: shadowed.filter(isGlow), contacts };
}

function expectContactOnly() {
  const { scopes, shadowed, contacts } = cardHosts();
  expect(scopes).toBeGreaterThan(0);
  expect(feltScale()).not.toBe(1);
  expect(contacts.length).toBeGreaterThan(0);
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
  it.each<Scenario>(['throw', 'deal', 'exchange'])('is registered exactly as drawn and casts only its own contact through a %s', async (scenario) => {
    let peak = 0;
    await setWindow({ width: 1180, height: 820 });
    await runScenario(scenario, (t) => {
      expectExactlyDrawn();
      expectContactOnly();
      peak = Math.max(peak, scoped(FLYING[scenario]).length);
      if (scenario !== 'throw' || (t !== THROW.air && t !== THROW.rest)) return;
      expect(scoped('pile')).toEqual(['pile:a', 'pile:b']);
      if (t === THROW.air) {
        expect(scoped('hand').length).toBeGreaterThan(0);
        expect(scoped('fan').length).toBeGreaterThan(0);
      }
    });
    expect(peak).toBeGreaterThan(0);
    await frames(32);
    expect(registry()).toEqual({});
  }, 120_000);

  it("carries no elevation below Android 9, where it would paint a card's box over its own level shade, and the felt draws its contact", async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    const version = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(27);
    const e2e = globalThis as { murlanShadowClusterBuilds?: Record<string, number> };
    delete e2e.murlanShadowClusterBuilds;
    try {
      let seen = 0;
      const elevated: Record<string, unknown>[] = [];
      const viewContacts: Record<string, unknown>[] = [];
      const owed = new Set<string>();
      await runScenario('throw', () => {
        const { scopes, shadowed, contacts } = cardHosts();
        seen += scopes;
        elevated.push(...[...shadowed, ...contacts].map(styleOf).filter((s) => s.elevation !== undefined));
        viewContacts.push(...contacts.map(styleOf));
        const rects = registry();
        for (const key of Object.keys(rects)) if (!key.startsWith('fan:') && shadowRect(rects[key]).seen > 0) owed.add(`${shadowRect(rects[key]).back ? 'back' : 'face'}|${key}`);
      });
      const drawn = new Set(Object.keys(e2e.murlanShadowClusterBuilds ?? {}).flatMap((cluster) => {
        const [kind, members] = cluster.split('|');
        return members.split(',').map((key) => `${kind}|${key}`);
      }));
      expect(seen).toBeGreaterThan(0);
      expect(elevated).toEqual([]);
      expect(viewContacts).toEqual([]);
      expect(owed.size).toBeGreaterThan(0);
      expect([...owed].filter((at) => !drawn.has(at))).toEqual([]);
    } finally {
      version.mockRestore();
      os.restore();
    }
  }, 120_000);

  it("lights the pile's cards through a going-out catch, and not through a play that leaves cards in hand", async () => {
    const lit = (): number => Math.max(0, ...scoped('pile').map((k) => registry()[k].glow));
    let caught = 0;
    await runScenario('goingOut', () => {
      caught = Math.max(caught, lit());
    });
    let kept = 0;
    const view = await render(cardTable(pairThrownBy3(dealCards(4).hands, false)));
    await frames(3000, () => {
      kept = Math.max(kept, lit());
    });
    await view.unmount();
    expect(caught).toBeGreaterThan(0.5);
    expect(kept).toBe(0);
  }, 120_000);

  it('carries no shadow but its contact however many cards are held', async () => {
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
  it("keeps today's static shadow, its cast read from the table's root where the web felt is still baking", async () => {
    const face = card('7', 'clubs');
    const off = await render(<CardView card={face} />);
    expect(StyleSheet.flatten(screen.getByTestId('card-box').props.style).boxShadow).toBe(cardShadow('face').boxShadow);
    await off.unmount();
    const baking = await render(
      <CardCastContext.Provider value="table">
        <CardView card={face} />
      </CardCastContext.Provider>
    );
    expect(StyleSheet.flatten(screen.getByTestId('card-box').props.style).boxShadow).toBe(cardShadow('face', 'table').boxShadow);
    expect(cardShadow('face', 'table').boxShadow).toContain(`var(${TABLE_CAST.x}, 0px) var(${TABLE_CAST.y}, ${CardShadow.fall.drop}px)`);
    await baking.unmount();
  });

  it("sets restingCast's offset, in px, on the table's root while the web felt is still baking", async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      const felt = { sx: 1.2, sy: 0.9, s: 1.1 };
      const pile = { x: 437, y: 180 };
      const set = new Map<string, string>();
      const root = { style: { setProperty: (name: string, value: string) => void set.set(name, value) } };
      const view = await renderHook(({ ready, pool }: { ready: boolean; pool: Pool }) => useCardCast(ready, restingCast(pile, pool, felt)), {
        initialProps: { ready: false, pool: [437, 120, 1] as Pool },
      });
      expect(view.result.current[0]).toBe('table');
      await act(async () => view.result.current[1](root as unknown as React.ComponentRef<typeof View>));
      const at = (pool: Pool) => {
        const { x, y } = restingCast(pile, pool, felt);
        return new Map([[TABLE_CAST.x, `${x}px`], [TABLE_CAST.y, `${y}px`]]);
      };
      expect(set).toEqual(at([437, 120, 1]));
      await act(async () => view.rerender({ ready: false, pool: [120, 300, 1] }));
      expect(set).toEqual(at([120, 300, 1]));
      await act(async () => view.rerender({ ready: true, pool: [700, 300, 1] }));
      expect(view.result.current[0]).toBe('felt');
      expect(set).toEqual(at([120, 300, 1]));
      await view.unmount();
    } finally {
      os.restore();
    }
  });

  it("gives a card on the web fallback the contact and the tight cast, a lifted one a larger fall (#1966)", async () => {
    const face = card('7', 'clubs');
    const shadowOf = async (selected: boolean, rectKey?: string) => {
      const view = await render(
        <CardCastContext.Provider value="table">
          <CardView card={face} rectKey={rectKey} selected={selected} />
        </CardCastContext.Provider>
      );
      const shadow = StyleSheet.flatten(screen.getByTestId('card-box').props.style).boxShadow as string;
      await view.unmount();
      return shadow;
    };
    const rest = await shadowOf(false, `hand:${face.id}`);
    expect(rest).toBe(await shadowOf(false, `deal:${face.id}`));
    expect(rest).toContain(`var(${TABLE_CAST.x}, 0px) var(${TABLE_CAST.y}, ${CardShadow.fall.drop}px) ${CardShadow.cast.blur}px ${withAlpha(Colors.shadow, CardShadow.cast.alpha)}`);
    expect(rest).toContain(`0px ${CardShadow.contact.y}px ${CardShadow.contact.blur}px`);
    const lifted = await shadowOf(true, `hand:${face.id}`);
    expect(lifted).toContain(`0px ${CardShadow.lifted.y}px ${CardShadow.lifted.blur}px`);
    expect(CardShadow.lifted.blur).toBeGreaterThan(CardShadow.cast.blur);
  });
});
