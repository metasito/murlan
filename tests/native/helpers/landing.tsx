import { jest } from '@jest/globals';
import { useEffect } from 'react';
import { useShownTurn, useTableFeedback } from '@/components/useTableFeedback';
import { useTableTimeline } from '@/components/table/tableTimeline';
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

export const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card =>({ id, rank, suit, isJoker: false });
const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: Array.from({ length: 5 }, (_, k) => card(`s${i}_${k}`, '3', 'spades')),
  type: 'human',
});
export const PAIR: Combination ={ type: 'pair', cards: [card('a', '5', 'clubs'), card('b', '5', 'diamonds')], strength: 5 };
const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const noop = () => {};

/** The viewer's four-seat table mounting on a pair just thrown by seat `by`, which flies on mount; seat 0 is on move. */
export function throwPair(by = 3) {
  return render(tableAfter({ by, combo: PAIR }));
}

/** That table as an element, for `rerender`: `by` threw `combo` and seat `turn` is on move. */
export function tableAfter({ by, combo, passCount = 0, turn = 0 }: { by: number; combo: Combination; passCount?: number; turn?: number }) {
  const state: GameState = {
    players: [0, 1, 2, 3].map(seat),
    currentTurnIndex: turn,
    lastPlayedCombination: combo,
    lastPlayedBy: by,
    passCount,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
  };
  return (
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

/** `useTableFeedback` on its own timeline, flushed after it as GameTable's last hook does. */
export function useFeedbackOnTimeline({ currentTurnIndex = 0, ...state }: Omit<Parameters<typeof useTableFeedback>[0], 'timeline'> & { currentTurnIndex?: number }) {
  const timeline = useTableTimeline();
  const feedback = useTableFeedback({ ...state, timeline });
  const shownTurnIndex = useShownTurn(currentTurnIndex, timeline);
  useEffect(() => timeline.flush());
  return { ...feedback, shownTurnIndex };
}

/** How far the farthest flying card is drawn from its slot, to a micro-point: at rest the pose's float math leaves ~1e-15. */
export const farthest = (view: RenderResult) =>
  Math.max(
    0,
    ...view.queryAllByTestId('flying-card', { includeHiddenElements: true }).map((el) => {
      const t = ((getAnimatedStyle(el) as { transform?: Record<string, number>[] }).transform ?? []);
      const x = t.find((s) => 'translateX' in s)?.translateX ?? 0;
      const y = t.find((s) => 'translateY' in s)?.translateY ?? 0;
      return Math.round(Math.hypot(x, y) * 1e6) / 1e6;
    })
  );

/** Steps frames until `happened`, recording how far the cards were drawn on each, and when. */
export async function frameOfFirst(view: RenderResult, happened: () => boolean) {
  const drawn: number[] = [];
  const now: number[] = [];
  for (let f = 0; f < 60; f++) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    drawn.push(farthest(view));
    now.push(performance.now());
    if (happened()) return { frame: f, drawn, now };
  }
  throw new Error('never happened');
}
