// tests/native/dealTurn.test.tsx — the viewer's turn is given when the deal lands, not from its first frame (#1432).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { HAND_SCALE, HAND_SCALE_ON_TURN } from '@/components/cardFaceModel';
import { type CardRects } from '@/components/table/cardRects';
import { dealCards, type GameState, type Player } from '@/lib/game/gameEngine';
import { Colors, Motion } from '@/lib/theme';
import { en } from '@/locales/en';
import { bootFeedback, haptics } from './helpers/feedback';

const mockWindow = { width: 844, height: 390, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

const HIDDEN_TOO = { includeHiddenElements: true };

const freshDeal = (): GameState => ({
  players: dealCards(4).hands.map((hand, i) => ({ id: `p${i}`, name: `P${i}`, hand, type: 'human' }) as Player),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
});

const table = (gameState: GameState, { width, height } = { width: 844, height: 390 }) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
    <GameTable gameState={gameState} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
  </SafeAreaProvider>
);

const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));
const dealing = () => JSON.stringify(screen.toJSON()).includes('"dealing":"true"');
const chipReadsYourTurn = () =>
  within(screen.getByTestId('game-hud-stack')).queryByText(en['gameShared.yourTurn'], HIDDEN_TOO) !== null;
const chipIsLit = () =>
  JSON.stringify(screen.getByTestId('turn-chip-dot', HIDDEN_TOO).props.style).includes(Colors.goldLit);
const giocaIsLit = () => {
  const label = within(screen.getByTestId('btn-gioca')).getByText(en['gameTable.playLabelGioca'], HIDDEN_TOO);
  return StyleSheet.flatten(label.props.style).color === Colors.bg;
};
const handCardW = () => {
  const [card] = screen.getAllByTestId(/^hand-card-/, HIDDEN_TOO);
  return StyleSheet.flatten(card.props.style).width as number;
};
const handCardScale = () => {
  const [card] = screen.getAllByTestId(/^hand-card-/, HIDDEN_TOO);
  const { transform = [] } = getAnimatedStyle(card) as { transform?: Record<string, number>[] };
  return transform.find((t) => 'scale' in t)?.scale ?? 1;
};
const chipReads = (key: keyof typeof en) => within(screen.getByTestId('game-hud-stack')).queryByText(en[key], HIDDEN_TOO) !== null;
const tableSays = (key: keyof typeof en) => JSON.stringify(screen.toJSON()).includes(en[key]);

describe("the viewer's turn waits for the deal to land", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows no turn while the cards fly, and gives it once they land', async () => {
    const view = await render(table(freshDeal()));
    await advance(400);
    expect(dealing()).toBe(true);
    expect(chipReadsYourTurn()).toBe(false);
    expect(chipIsLit()).toBe(false);
    expect(giocaIsLit()).toBe(false);
    expect(chipReads('gameShared.dealing')).toBe(true);
    expect(tableSays('gameTable.a11yYourTurn')).toBe(false);
    expect(JSON.stringify(screen.toJSON())).not.toContain(en['gameTable.a11yTurnOf'].replace('{{name}}', 'P0'));
    expect(haptics()).not.toContain('impactLight');
    const dealtW = handCardW();

    for (let ms = 0; dealing() && ms < 3000; ms += 160) await advance(160);
    expect(dealing()).toBe(false);
    expect(chipReadsYourTurn()).toBe(true);
    expect(chipIsLit()).toBe(true);
    expect(giocaIsLit()).toBe(true);
    expect(tableSays('gameTable.a11yYourTurn')).toBe(true);
    await advance(0);
    expect(haptics()).toContain('impactLight');
    expect(handCardW() / dealtW).toBeCloseTo(HAND_SCALE_ON_TURN / HAND_SCALE, 2);
    expect(handCardScale()).toBeLessThan(0.95);
    await advance(Motion.duration.shift + 32);
    expect(handCardScale()).toBeCloseTo(1, 2);
    await view.unmount();
  }, 20_000);

  it.each([
    ['a phone', 844, 390, false],
    ['a 4:3 tablet, where the grown fan starts to scroll', 1024, 768, true],  ])('on %s the landed cards grow from where they were drawn', async (_, width, height, scrolls) => {
    process.env.EXPO_PUBLIC_E2E_FAST = '1';
    Object.assign(mockWindow, { width, height });
    const view = await render(table(freshDeal(), { width, height }));
    const registry = () => (globalThis as { murlanCardRects?: () => CardRects }).murlanCardRects?.() ?? {};
    const pan = () => screen.queryByTestId('hand-pan');
    const rowPan = () => ((pan() && getAnimatedStyle(pan()!)) as { transform?: Record<string, number>[] } | null)?.transform?.[0]?.translateX ?? 0;
    let [before, last]: CardRects[] = [{}, {}];
    for (let ms = 0; dealing() && ms < 3000; ms += 160) [before, last] = [last, registry()], await advance(160);
    const id = Object.keys(last).find((k) => k.startsWith('hand:') && Math.abs(last[k].x - before[k]?.x) < 0.01)!;
    expect(rowPan() < -1).toBe(scrolls);
    const landed = registry()[id];
    expect(landed.x).toBeCloseTo(last[id].x, 0);
    expect(landed.y).toBeCloseTo(last[id].y, 0);
    expect(landed.w).toBeCloseTo(last[id].w, 0);
    await advance(Motion.duration.shift + 32);
    expect(registry()[id].w / last[id].w).toBeCloseTo(HAND_SCALE_ON_TURN / HAND_SCALE, 2);
    await view.unmount();
    delete process.env.EXPO_PUBLIC_E2E_FAST;
  }, 20_000);
});
