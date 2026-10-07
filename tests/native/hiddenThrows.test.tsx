import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';

jest.mock('@/components/table/particles', () => {
  const actual = jest.requireActual<typeof import('@/components/table/particles')>('@/components/table/particles');
  return { ...actual, landingDust: jest.fn(actual.landingDust) };
});

import { landingDust } from '@/components/table/particles';
import type { Combination } from '@/lib/game/gameEngine';
import { bootFeedback, settle, sounds } from './helpers/feedback';
import { card, PAIR, tableAfter } from './helpers/landing';

const SINGLE: Combination = { type: 'single', cards: [card('c', '4', 'hearts')], strength: 4 };
const frames = (n: number) => settle(16 * n);
const fliers = (view: Awaited<ReturnType<typeof render>>) => view.queryAllByTestId('flying-card', { includeHiddenElements: true }).length;
const dusts = () => jest.mocked(landingDust).mock.calls.map(([l]) => l.cards);

describe('throws committed while no frame is drawn', () => {
  let was: typeof AppState.currentState;
  beforeEach(async () => {
    was = AppState.currentState;
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    AppState.currentState = was;
    jest.useRealTimers();
  });

  it('land all but the newest at once, with no sound or dust, and the newest flies', async () => {
    AppState.currentState = 'background';
    const view = await render(tableAfter({ by: 3, combo: SINGLE }));
    await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR })));
    expect(fliers(view)).toBe(PAIR.cards.length);

    AppState.currentState = 'active';
    await frames(60);
    expect(dusts()).toEqual([2]);
    expect(sounds()).toContain('combo');
    expect(sounds()).not.toContain('play');
    expect(fliers(view)).toBe(0);
    await view.unmount();
  });

  it('keeps both landings for two plays in one frame of a visible table', async () => {
    AppState.currentState = 'active';
    const view = await render(tableAfter({ by: 3, combo: SINGLE }));
    await act(async () => view.rerender(tableAfter({ by: 0, combo: PAIR })));
    expect(fliers(view)).toBe(SINGLE.cards.length + PAIR.cards.length);

    await frames(60);
    expect([...dusts()].sort()).toEqual([1, 2]);
    await view.unmount();
  });
});
