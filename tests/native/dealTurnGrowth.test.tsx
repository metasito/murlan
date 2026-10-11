// tests/native/dealTurnGrowth.test.tsx — the landed hand grows into its turn size from where the deal drew it (#1432).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

import { HAND_SCALE, HAND_SCALE_ON_TURN } from '@/components/cardFaceModel';
import { type CardRects } from '@/components/table/cardRects';
import { Motion } from '@/lib/theme';
import { bootFeedback } from './helpers/feedback';
import { advance, dealing, freshDeal, table } from './helpers/dealTurnTable';

jest.mock('@/lib/accessibility', () => ({
  ...jest.requireActual<typeof import('@/lib/accessibility')>('@/lib/accessibility'),
  usePrefersReducedMotion: () => false,
}));

const mockWindow = { width: 844, height: 390, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

describe('the landed cards grow into the turn size', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['a phone', 844, 390, false],
    ['a 4:3 tablet, where the grown fan starts to scroll', 1024, 768, true],
  ])('on %s the landed cards grow from where they were drawn', async (_, width, height, scrolls) => {
    process.env.EXPO_PUBLIC_E2E_FAST = '1';
    Object.assign(mockWindow, { width, height });
    const view = await render(table(freshDeal(), { width, height }));
    const registry = () => (globalThis as { murlanCardRects?: () => CardRects }).murlanCardRects?.() ?? {};
    const pan = () => screen.queryByTestId('hand-pan');
    const rowPan = () => ((pan() && getAnimatedStyle(pan()!)) as { transform?: Record<string, number>[] } | null)?.transform?.[0]?.translateX ?? 0;
    let [before, last]: CardRects[] = [{}, {}];
    for (let ms = 0; dealing() && ms < 3000; ms += 160) {
      [before, last] = [last, registry()];
      await advance(160);
    }
    const id = Object.keys(last).find((k) => k.startsWith('hand:') && Math.abs(last[k].x - before[k]?.x) < 0.01)!;
    expect(rowPan() < -1).toBe(scrolls);
    const landed = registry()[id];
    expect(landed.x).toBeCloseTo(last[id].x, 0);
    expect(landed.y).toBeCloseTo(last[id].y, 0);
    expect(landed.w).toBeCloseTo(last[id].w, 0);
    await advance(Motion.handResize + 32);
    expect(registry()[id].w / last[id].w).toBeCloseTo(HAND_SCALE_ON_TURN / HAND_SCALE, 2);
    await view.unmount();
    delete process.env.EXPO_PUBLIC_E2E_FAST;
  }, 20_000);
});
