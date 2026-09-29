// tests/native/flightStartsOnce.test.tsx — jest runs without the React Compiler, so a throw that
// restarts on its parent's re-render shows here even when the compiled app hides it.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { NO_LANDING } from '@/components/table/useFlightClock';
import type { Card } from '@/lib/game/gameEngine';
import { flightOf, pileOf } from './helpers/landing';

const CARDS: Card[] = [
  { id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card,
  { id: 'A_hearts', rank: 'A', suit: 'hearts', isJoker: false } as Card,
];
const FROM = CARDS.map((_, i) => ({ x: -40 + 80 * i, y: 160, rot: 0, scale: 1.4 }));

describe('a throw', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts its clock once, whatever its parent re-renders', async () => {
    const onStart = jest.fn();
    const signal = makeMutable(NO_LANDING);
    const flight = flightOf('k1', CARDS, FROM);
    const tree = (n: number) =>
      pileOf({ plays: [{ ...flight }], flights: [flight], signal, onFlightStart: (...a: unknown[]) => onStart(n, ...a) });
    const view = await render(tree(0));
    for (let r = 1; r <= 3; r++) {
      await act(async () => { jest.advanceTimersByTime(16); });
      await view.rerender(tree(r));
    }
    await act(async () => { jest.advanceTimersByTime(16 * 40); });
    expect(onStart).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
