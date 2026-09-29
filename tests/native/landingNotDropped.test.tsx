// tests/native/landingNotDropped.test.tsx — a play thrown while the last is still in the air
// does not cancel that one's landing: both sound, both throw their dust.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render } from '@testing-library/react-native';

jest.mock('@/components/table/particles', () => {
  const actual = jest.requireActual<typeof import('@/components/table/particles')>('@/components/table/particles');
  return { ...actual, landDust: jest.fn(actual.landDust) };
});

import { landDust } from '@/components/table/particles';
import type { Combination } from '@/lib/game/gameEngine';
import { bootFeedback, settle, sounds } from './helpers/feedback';
import { card, PAIR, tableAfter } from './helpers/landing';

const SINGLE: Combination = { type: 'single', cards: [card('c', '4', 'hearts')], strength: 4 };
const frames = (n: number) => settle(16 * n);

describe('two plays in the air at once', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lands both', async () => {
    const view = await render(tableAfter({ by: 3, combo: SINGLE }));
    await frames(5);
    await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR })));
    await frames(60);
    expect(sounds()).toEqual(expect.arrayContaining(['play', 'combo']));
    expect(jest.mocked(landDust).mock.calls.map(([cards]) => cards)).toEqual([1, 2]);
    await view.unmount();
  });

  it('lands a play repeated after the last one was cut short in its wobble', async () => {
    const view = await render(tableAfter({ by: 3, combo: PAIR }));
    await frames(30);
    await act(async () => view.rerender(tableAfter({ by: 0, combo: SINGLE })));
    await frames(60);
    await act(async () => view.rerender(tableAfter({ by: 3, combo: PAIR })));
    await frames(5);
    await act(async () => view.rerender(tableAfter({ by: 1, combo: SINGLE })));
    await frames(60);
    expect(jest.mocked(landDust).mock.calls.map(([cards]) => cards)).toEqual([2, 1, 2, 1]);
    await view.unmount();
  });
});
