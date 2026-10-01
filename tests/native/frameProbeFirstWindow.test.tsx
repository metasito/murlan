import { beforeAll, expect, it, jest } from '@jest/globals';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

// Reanimated's native mutable (src/mutables.ts, src/valueSetter.ts): a UI write of the same reference
// without forceUpdate is skipped, and a JS read returns its own copy until a UI write marks it dirty.
const mockRuntime = { onUI: false };
jest.mock('react-native-reanimated', () => {
  const copy = <T,>(v: T): T => (Array.isArray(v) ? ([...v] as T) : v);
  const makeMutable = <T,>(initial: T) => {
    let ui = copy(initial);
    let cached = initial;
    let dirty = false;
    const write = (v: T, force: boolean) => {
      if (v === ui && !force) return;
      ui = v;
      dirty = true;
    };
    const mutable = {
      get value(): T {
        if (mockRuntime.onUI) return ui;
        if (dirty) {
          dirty = false;
          cached = copy(ui);
        }
        return cached;
      },
      set value(v: T) {
        write(mockRuntime.onUI ? v : copy(v), false);
      },
      get: (): T => mutable.value,
      set: (v: T) => {
        mutable.value = v;
      },
      modify: (fn: (v: T) => T, force = true) => write(fn(ui), force),
    };
    return mutable;
  };
  return { ...jest.requireActual<object>('react-native-reanimated'), makeMutable };
});

let probe: typeof import('@/lib/diagnostics/FrameProbe');
beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  probe = require('@/lib/diagnostics/FrameProbe');
});

const uiFrame = (dt: number) => {
  mockRuntime.onUI = true;
  try {
    probe.sampleFrame({ timeSincePreviousFrame: dt, timestamp: 0, timeSinceFirstFrame: 0 });
  } finally {
    mockRuntime.onUI = false;
  }
};

it("restCost's first frozen half: the first window after launch keeps its frames, as every later one does", () => {
  void probe.armFrames(true).catch(() => {});
  uiFrame(Number.NaN);
  const perWindow = [0, 1, 2].map(() => {
    mockRows.length = 0;
    probe.recordFrames(true);
    for (let i = 0; i < 3; i++) uiFrame(8);
    probe.recordFrames(false);
    return mockRows.filter((r) => r.k === 'frame').length;
  });
  void probe.armFrames(false);
  expect(perWindow).toEqual([3, 3, 3]);
});
