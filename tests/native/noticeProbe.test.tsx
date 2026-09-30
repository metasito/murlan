import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

let gallery: typeof import('@/components/table/notices/gallery').NOTICE_GALLERY;
let setMotionPreference: typeof import('@/lib/accessibility').setMotionPreference;

beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  gallery = require('@/components/table/notices/gallery').NOTICE_GALLERY;
  setMotionPreference = require('@/lib/accessibility').setMotionPreference;
});

beforeEach(() => {
  mockRows.length = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  setMotionPreference('system');
});

const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const rows = <K extends DiagRow['k']>(k: K) => mockRows.filter((r): r is Extract<DiagRow, { k: K }> => r.k === k);
const FRAME = 17;

describe('a diagnostics build times every notice in UI frames', () => {
  it('a pill records its 160 ms entrance, a float its 100 ms entrance and exit, a still mark only that it showed', async () => {
    for (const [fixture, want] of [
      [gallery.hudCombo[0], [['hudCombo', 'pill', 'enter', 160]]],
      [gallery.passFloat[0], [['passFloat', 'float', 'enter', 100], ['passFloat', 'float', 'exit', 100]]],
      [gallery.pileLabel[0], [['pileLabel', 'chip', 'still', 0]]],
    ] as const) {
      mockRows.length = 0;
      const view = await render(fixture.render(1));
      await advance(2000);
      const got = rows('notice');
      expect(got.map((r) => [r.kind, r.shape, r.phase])).toEqual(want.map(([k, s, p]) => [k, s, p]));
      got.forEach((r, i) => {
        expect(r.ms).toBeGreaterThanOrEqual(want[i][3]);
        expect(r.ms).toBeLessThan(want[i][3] + FRAME);
        if (r.phase !== 'still') expect(r.dt).toBeGreaterThan(r.ms - want[i][3]);
      });
      await view.unmount();
    }
  });

  it('a notice inside the gallery stamps its rows gallery, one outside stamps none', async () => {
    const { NoticeSource } = require('@/components/table/TableNotice') as typeof import('@/components/table/TableNotice');
    const pill = gallery.hudCombo[0];
    let view = await render(<NoticeSource.Provider value="gallery">{pill.render(1)}</NoticeSource.Provider>);
    await advance(2000);
    await view.unmount();
    expect(rows('notice').map((r) => r.src)).toEqual(['gallery']);
    mockRows.length = 0;
    view = await render(pill.render(1));
    await advance(2000);
    await view.unmount();
    expect(rows('notice').map((r) => r.src)).toEqual([undefined]);
  });

  it("the reconnecting dot records each 900 ms blink, and under reduced motion no blink and an opacity of 1", async () => {
    const reconnecting = gallery.turn.find((f) => f.name === 'reconnecting')!;
    let view = await render(reconnecting.render(1));
    const opacity = () => (getAnimatedStyle(screen.getByTestId('turn-chip-dot', { includeHiddenElements: true })) as { opacity: number }).opacity;
    await advance(450 + FRAME);
    expect(opacity()).toBeLessThan(0.3);
    await advance(450);
    expect(opacity()).toBeGreaterThan(0.9);
    await advance(2000);
    const periods = rows('blink').map((r) => r.period);
    expect(periods.length).toBeGreaterThanOrEqual(2);
    for (const p of periods) expect(Math.abs(p - 900)).toBeLessThan(2 * FRAME);
    await view.unmount();

    mockRows.length = 0;
    setMotionPreference('on');
    view = await render(reconnecting.render(1));
    await advance(2000);
    await view.unmount();
    expect(rows('blink')).toEqual([]);
    expect(rows('dot').map((r) => [r.kind, r.opacity])).toEqual([['turn', 1]]);
  });
});
