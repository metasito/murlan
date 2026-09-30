import { beforeAll, expect, it, jest } from '@jest/globals';
import type { DiagRow } from '@/lib/diagnostics';
import type { BenchContext, NoticeShot } from '@/lib/diagnostics/bench';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

let scenarios: Map<string, (ctx: BenchContext) => Promise<void>>;
let motion: typeof import('@/lib/accessibility');

beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  require('@/lib/diagnostics/scenarios');
  motion = require('@/lib/accessibility');
  scenarios = new Map((require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench')).benchScenarios());
});

it('noticeGallery shows every fixture five times and once more under reduced motion, framed, over a table the bots play on', async () => {
  const log: string[] = [];
  let tables = 0;
  motion.setMotionPreference('off');
  await scenarios.get('noticeGallery')!({
    params: {},
    showTable: async (state) => {
      if (state) tables++;
      log.push(state ? 'table' : 'no table');
    },
    sleep: async () => {},
    frames: (on) => void log.push(`frames ${on}`),
    armFrames: async (on) => void log.push(`arm ${on}`),
    feltSample: async () => {
      throw new Error('unused');
    },
    gallery: { hudCombo: ['a', 'b'], passFloat: ['c'] },
    showNotice: (shot: NoticeShot | null) =>
      void log.push(shot ? `show ${shot.kind} ${shot.fixture} ${motion.getMotionPreference()}` : 'hide'),
  });
  const once = (pref: string) => [`show hudCombo 0 ${pref}`, `show hudCombo 1 ${pref}`, `show passFloat 0 ${pref}`];
  const shows = log.filter((l) => l.startsWith('show'));
  expect(shows).toEqual([...Array.from({ length: 5 }, () => once('off')).flat(), ...once('on')]);
  const own = log.filter((l) => /^(show|hide|frames)/.test(l)).slice(0, 4);
  expect(own).toEqual(['frames true', 'show hudCombo 0 off', 'hide', 'frames false']);
  expect(mockRows.filter((r) => r.k === 'gallery')).toMatchObject([{ kinds: 2, fixtures: 3 }]);
  expect(mockRows.flatMap((r) => (r.k === 'shown' ? [r.reduced] : []))).toEqual([...Array(15).fill(false), true, true, true]);
  expect(motion.getMotionPreference()).toBe('off');
  expect(tables).toBeGreaterThan(1);
  expect(log.at(-2)).toBe('no table');
  expect(log.at(-1)).toBe('arm false');
});
