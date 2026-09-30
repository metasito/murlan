// tests/native/pileLayers.test.tsx — which of the pile's plays is drawn, and which covers which.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { makeMutable, type SharedValue } from 'react-native-reanimated';
import type { TestInstance } from 'test-renderer';
import { NO_LANDING, type LandingSignal } from '@/components/table/useFlightClock';
import type { Flight } from '@/components/table/pile';
import type { TrickPlay } from '@/components/table/trick';
import type { Card } from '@/lib/game/gameEngine';
import { card, flightOf, pileOf } from './helpers/landing';

const play = (k: string, rank: Card['rank'] = '5') => flightOf(k, [card(k, rank, 'clubs')], [{ x: 0, y: 160, rot: 0, scale: 1.4 }]);
const resting = ({ key, combo, playedBy, spec }: Flight): TrickPlay => ({ key, combo, playedBy, spec });
const style = (n: TestInstance) => (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, unknown>;
const shown = (n: TestInstance | null) => {
  for (; n; n = n.parent) if (style(n).display === 'none') return false;
  return true;
};
function groupOf(n: TestInstance | null) {
  while (n && style(n).left !== '50%') n = n.parent;
  return n!;
}

function Throws({ all, signal }: { all: Flight[]; signal: SharedValue<LandingSignal> }) {
  const [flights, setFlights] = useState(all);
  return pileOf({ plays: all.map(resting), flights, signal, onFlightEnd: (k) => setFlights((f) => f.filter((x) => x.key !== k)) });
}

describe('the pile', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('draws every play in the air until it lands, however many are thrown over it', async () => {
    const signal = makeMutable(NO_LANDING);
    const view = await render(<Throws all={['a', 'b', 'c'].map((k) => play(k))} signal={signal} />);
    let frames = 0;
    while (view.queryAllByTestId('flying-cards', { includeHiddenElements: true }).length > 0 && frames < 200) {
      const fliers = view.queryAllByTestId('flying-card', { includeHiddenElements: true });
      expect(fliers.filter((f) => !shown(f)).map((f) => groupOf(f).props.testID ?? 'group')).toEqual([]);
      await act(async () => { jest.advanceTimersByTime(16); });
      frames += 1;
    }
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(200);
    expect(signal.value.seq).toBe(3);
    await view.unmount();
  });

  it('lays the swept trick over the felt and a play in the air over both, each play over the one it beat', async () => {
    const ranks: Card['rank'][] = ['3', '4', '5', '6', '7', '8'];
    const [s1, s2, p1, p2, p3, f] = ranks.map((r) => play(`k${r}`, r));
    const view = await render(
      pileOf({ trick: { plays: [p1, p2, p3].map(resting), swept: { plays: [s1, s2].map(resting), to: { dx: 0, dy: -200 } } }, flights: [f] })
    );
    const cards = view.getAllByTestId('pile-card', { includeHiddenElements: true });
    const z = (r: string) => style(groupOf(cards.find((c) => c.props.accessibilityLabel === `${r} of Clubs`)!)).zIndex as number;
    const order = ['8', '4', '3', '7', '6', '5'].map(z);
    expect(order.every((v) => typeof v === 'number')).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(new Set(order).size).toBe(order.length);
    await view.unmount();
  });
});
