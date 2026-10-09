import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle, makeMutable } from 'react-native-reanimated';

const mockOnsets: string[] = [];
const mockSources = new Map<string, () => unknown>();
const mockPulses: { strength: string; at: number }[] = [];
const mockTrauma: number[] = [];

jest.mock('@/lib/e2eTrace', () => ({
  ...jest.requireActual<object>('@/lib/e2eTrace'),
  traceOnset: (kind: string, name: string) => mockOnsets.push(`${kind}:${name}`),
  useTraceSource: (field: string, read: () => unknown) => void mockSources.set(field, read),
}));
jest.mock('@/lib/device/hapticsEngine', () => {
  const actual = jest.requireActual<typeof import('@/lib/device/hapticsEngine')>('@/lib/device/hapticsEngine');
  return { ...actual, pulse: (strength: string) => void mockPulses.push({ strength, at: performance.now() }) };
});
jest.mock('@/components/flightPhysics', () => {
  const actual = jest.requireActual<typeof import('@/components/flightPhysics')>('@/components/flightPhysics');
  return {
    ...actual,
    traumaFor: (...args: Parameters<typeof actual.traumaFor>) => {
      const t = actual.traumaFor(...args);
      mockTrauma.push(t);
      return t;
    },
  };
});

import { GameTable } from '@/components/GameTable';
import { BombFlash } from '@/components/table/moments';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { farthest, fireLanding, frameOfFirst } from './helpers/landing';
import { setMotionPreference } from '@/lib/accessibility';
import { BombFx, Motion } from '@/lib/theme';
import type { Card, Combination, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const seat = (id: string, name: string, hand: Card[]): Player => ({ id, name, hand, type: 'human' });
const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const KEEP = card('3', 'clubs');
const PAIR: Combination = { type: 'pair', cards: [card('7', 'hearts'), card('7', 'diamonds')], strength: 7 };
const BOMB: Combination = {
  type: 'bomb',
  cards: [card('9', 'hearts'), card('9', 'spades'), card('9', 'diamonds'), card('9', 'clubs')],
  strength: 9,
};
const state = (play: Combination, by: number): GameState => ({
  players: [seat('player_0', 'Ana', [KEEP]), seat('player_1', 'Besi', [KEEP])],
  currentTurnIndex: 1 - by,
  lastPlayedCombination: play,
  lastPlayedBy: by,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});
const noop = () => {};
const table = (s: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={s} viewerSeat={1} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
  </SafeAreaProvider>
);

const opacity = (id: string) => (getAnimatedStyle(screen.getByTestId(id, { includeHiddenElements: true })) as { opacity?: number }).opacity ?? 0;
const scaleOf = (id: string) =>
  ((getAnimatedStyle(screen.getByTestId(id, { includeHiddenElements: true })) as { transform?: Record<string, number>[] }).transform ?? []).find((t) => 'scale' in t)?.scale ?? 0;
const asideX = () =>
  ((getAnimatedStyle(screen.getByTestId('pile-prev-layer', { includeHiddenElements: true })) as { transform?: Record<string, number>[] }).transform ?? []).find((t) => 'translateX' in t)?.translateX ?? 0;
const lampFlare = () => (mockSources.get('lamp')?.() as { flare: number }).flare;
const lampKick = () => (mockSources.get('lamp')?.() as { kick: number }).kick;
const live = () => mockSources.get('live')?.() as number;
const scrim = () => opacity('felt-scrim');

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function bombLands() {
  const r = await render(table(state(PAIR, 0)));
  await advance(2000);
  await r.rerender(table(state(BOMB, 1)));
  mockPulses.length = 0;
  mockTrauma.length = 0;
  mockOnsets.length = 0;
  const dark: number[] = [];
  const { now } = await frameOfFirst(r, () => {
    dark.push(scrim());
    return farthest(r) <= 1;
  });
  return { r, contact: now.at(-1)!, dark };
}

describe("the bomb's beat keeps everything that hits (#1263)", () => {
  beforeEach(() => {
    setMotionPreference('off');
    jest.useFakeTimers();
  });
  afterEach(async () => {
    jest.useRealTimers();
    await act(async () => setMotionPreference('system'));
  });

  it('rings, scrim, shake and pulses stay; the lamp, flash, aside and engine sparks come 90 ms later', async () => {
    const { r, contact, dark } = await bombLands();
    expect(Math.max(...dark)).toBeGreaterThan(0);
    expect(mockTrauma).toContain(0.55);
    expect(mockOnsets).toContain('moment:bomb');
    expect(mockOnsets).not.toContain('moment:bombFx');
    expect(opacity('bomb-flash')).toBe(0);
    expect(asideX()).toBe(0);
    const flareAtContact = lampFlare();
    const kickAtContact = lampKick();

    await advance(BombFx.delayMs - 30);
    expect(opacity('bomb-flash')).toBe(0);
    expect(mockOnsets).not.toContain('moment:bombFx');
    expect(lampKick()).toBeLessThanOrEqual(kickAtContact);

    await advance(40);
    expect(mockOnsets).toContain('moment:bombFx');
    expect(opacity('bomb-flash')).toBeGreaterThan(0);
    expect(lampFlare()).toBeGreaterThan(flareAtContact);
    expect(lampKick()).toBeGreaterThan(0.5);
    expect(asideX()).toBeLessThan(0);
    expect(live()).toBeGreaterThan(48 + 18);
    expect(live()).toBeLessThanOrEqual(160);

    await advance(Motion.duration.travel);
    for (const ring of ['bomb-wave-0', 'bomb-wave-1']) {
      expect(opacity(ring)).toBeGreaterThan(0);
      expect(scaleOf(ring)).toBeGreaterThan(0.15);
    }
    expect(screen.queryAllByTestId(/^spark-/, { includeHiddenElements: true })).toHaveLength(0);

    await advance(600);
    expect(opacity('bomb-flash')).toBe(0);
    expect(asideX()).toBe(0);
    expect(Math.abs(mockPulses[0].at - contact)).toBeLessThanOrEqual(16);
    expect(mockPulses.map((p) => [p.strength, p.at - mockPulses[0].at])).toEqual([
      ['rigid', 0],
      ['heavy', 256],
      ['light', 416],
    ]);
    await r.unmount();
  });

  it('under reduced motion the sound and pulses stay, and no sparks, flash, lamp kick, aside or shake', async () => {
    setMotionPreference('on');
    const { r } = await bombLands();
    const flareAtContact = lampFlare();
    await advance(BombFx.delayMs + 40);
    expect(mockOnsets).toContain('sound:bomb');
    expect(mockOnsets).not.toContain('moment:bombFx');
    expect(opacity('bomb-flash')).toBe(0);
    expect(lampFlare()).toBe(flareAtContact);
    expect(lampKick()).toBe(0);
    expect(asideX()).toBe(0);
    expect(mockTrauma.every((t) => t === 0)).toBe(true);
    await advance(600);
    expect(mockPulses.map((p) => p.strength)).toEqual(['rigid', 'heavy', 'light']);
    await r.unmount();
  });
});

describe("the bomb's flash (#1263)", () => {
  beforeEach(() => {
    setMotionPreference('off');
    jest.useFakeTimers();
  });
  afterEach(async () => {
    jest.useRealTimers();
    await act(async () => setMotionPreference('system'));
  });

  it('fades from 1 to 0 over 280 ms, ease-out, and a second bomb within 1 s does not flash again', async () => {
    const landing = makeMutable(NO_LANDING);
    const r = await render(<BombFlash landing={landing} />);
    await act(async () => fireLanding(landing, { cards: 4, tier: 'bomb' }));
    await advance(BombFx.delayMs);
    const start = opacity('bomb-flash');
    await advance(BombFx.flashMs / 2);
    const mid = opacity('bomb-flash');
    expect(start).toBeGreaterThan(0.9);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
    await advance(BombFx.flashMs);
    expect(opacity('bomb-flash')).toBe(0);

    await act(async () => fireLanding(landing, { cards: 4, tier: 'bomb' }));
    await advance(BombFx.delayMs + 20);
    expect(opacity('bomb-flash')).toBe(0);

    await advance(BombFx.flashGapMs);
    await act(async () => fireLanding(landing, { cards: 4, tier: 'bomb' }));
    await advance(BombFx.delayMs + 20);
    expect(opacity('bomb-flash')).toBeGreaterThan(0);
    await r.unmount();
  });
});
