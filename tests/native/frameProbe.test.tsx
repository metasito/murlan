import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

let probe: typeof import('@/lib/diagnostics/FrameProbe');
beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  probe = require('@/lib/diagnostics/FrameProbe');
});

const WALL = 1_000_000;
let jsNow = 0;
const frameAt = (js: number, dt: number) => {
  jsNow = js;
  probe.sampleFrame({ timeSincePreviousFrame: dt, timestamp: js, timeSinceFirstFrame: js });
};
const frames = () => mockRows.flatMap((r) => (r.k === 'frame' ? [[Math.round(r.t), Math.round(r.dt)]] : []));

describe('a throw window closes on the first frame past it', () => {
  beforeEach(() => {
    mockRows.length = 0;
    jsNow = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => jsNow);
    jest.spyOn(Date, 'now').mockImplementation(() => WALL + jsNow);
    probe.armFrames(true);
  });
  afterEach(() => {
    probe.armFrames(false);
    jest.restoreAllMocks();
  });

  it('a stall frame landing after the close at 700 ms is recorded as the gap up to the close', () => {
    probe.recordFrames(true, 600);
    frameAt(300, 8);
    jsNow = 700;
    probe.recordFrames(false);
    expect(frames()).toEqual([[300, 8], [700, 400]]);
  });

  it('the first frame ending past 600 ms is recorded, and the window stops recording there', () => {
    probe.recordFrames(true, 600);
    frameAt(300, 8);
    frameAt(650, 350);
    frameAt(658, 8);
    jsNow = 700;
    probe.recordFrames(false);
    expect(frames()).toEqual([[300, 8], [650, 350]]);
  });

  it('a window with no end records no gap at its close', () => {
    probe.recordFrames(true);
    frameAt(300, 8);
    jsNow = 700;
    probe.recordFrames(false);
    expect(frames()).toEqual([[300, 8]]);
  });
});

describe('the frame loop runs only while armed or recording', () => {
  const active = () => (globalThis as { _frameCallbackRegistry?: { activeFrameCallbacks: Set<number> } })._frameCallbackRegistry!.activeFrameCallbacks.size;
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  it('is inactive on mount, follows arming, and refuses a window while unarmed', async () => {
    const view = await render(<probe.FrameProbe />);
    await settle();
    expect(active()).toBe(0);
    expect(() => probe.recordFrames(true)).toThrow('registerFramedScenario');
    probe.armFrames(true);
    await settle();
    expect(active()).toBe(1);
    probe.recordFrames(true);
    probe.recordFrames(false);
    probe.armFrames(false);
    await settle();
    expect(active()).toBe(0);
    await view.unmount();
  });
});
