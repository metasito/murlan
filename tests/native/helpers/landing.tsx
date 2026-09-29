import { jest } from '@jest/globals';
import { act, render, type RenderResult } from '@testing-library/react-native';
import { getAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import type { ImpactTier } from '@/components/flightPhysics';
import { landingPulsesFor } from '@/lib/device/feedback';
import { NO_LANDING, type LandingSignal } from '@/components/table/useFlightClock';
import type { Card, Combination, GameState, Player } from '@/lib/game/gameEngine';

/** Writes one landing onto the signal, as the flight clock does on its contact frame. */
export function fireLanding(
  signal: SharedValue<LandingSignal>,
  l: { cards: number; heavy?: boolean; mine?: boolean; tier?: ImpactTier; flush?: boolean }
): void {
  const heavy = l.heavy ?? false;
  const mine = l.mine ?? false;
  const tier = l.tier ?? (heavy ? 'bomb' : 'ordinary');
  signal.value = {
    ...NO_LANDING,
    ...l,
    heavy,
    mine,
    tier,
    pulses: landingPulsesFor({ cards: l.cards, bomb: heavy, mine }),
    seq: signal.value.seq + 1,
    at: performance.now(),
  };
}

const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({ id, rank, suit, isJoker: false });
const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: Array.from({ length: 5 }, (_, k) => card(`s${i}_${k}`, '3', 'spades')),
  type: 'human',
});
const PAIR: Combination = { type: 'pair', cards: [card('a', '5', 'clubs'), card('b', '5', 'diamonds')], strength: 5 };
const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const noop = () => {};

/** The viewer's four-seat table mounting on a pair just thrown by seat `by`, which flies on mount. */
export function throwPair(by = 3) {
  const state: GameState = {
    players: [0, 1, 2, 3].map(seat),
    currentTurnIndex: 0,
    lastPlayedCombination: PAIR,
    lastPlayedBy: by,
    passCount: 0,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  };
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable
        gameState={state}
        viewerSeat={0}
        selectedIds={[]}
        onSelectCard={noop}
        onPlay={noop}
        onPass={noop}
        onQuit={noop}
        onExchangeGive={noop}
      />
    </SafeAreaProvider>
  );
}

/** How far the farthest flying card is drawn from its slot. */
export const farthest = (view: RenderResult) =>
  Math.max(
    0,
    ...view.queryAllByTestId('flying-card', { includeHiddenElements: true }).map((el) => {
      const t = ((getAnimatedStyle(el) as { transform?: Record<string, number>[] }).transform ?? []);
      const x = t.find((s) => 'translateX' in s)?.translateX ?? 0;
      const y = t.find((s) => 'translateY' in s)?.translateY ?? 0;
      return Math.hypot(x, y);
    })
  );

/** Steps frames until `happened`, recording how far the cards were drawn on each. */
export async function frameOfFirst(view: RenderResult, happened: () => boolean) {
  const drawn: number[] = [];
  for (let f = 0; f < 60; f++) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    drawn.push(farthest(view));
    if (happened()) return { frame: f, drawn };
  }
  throw new Error('never happened');
}
