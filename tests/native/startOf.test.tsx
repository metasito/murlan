import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { AppState } from 'react-native';
import { inBackground, stampChange, startOf } from '@/lib/motion';

const PER_MS = 0.85 / 400;

describe('where a motion that began at `at` starts, given its first frame', () => {
  let was: typeof AppState.currentState;
  beforeEach(() => {
    was = AppState.currentState;
  });
  afterEach(() => {
    AppState.currentState = was;
  });

  it('on web runs on the change\'s clock when the first frame comes late, so the late frame loses none of the motion', () => {
    const at = 1000;
    const firstFrame = at + 50;
    expect(startOf(firstFrame, at, true)).toBe(at);
    expect(PER_MS * (firstFrame - startOf(firstFrame, at, true))).toBeCloseTo(PER_MS * 50, 9);
  });

  it('on web never starts before the first frame it could have drawn if the change is stamped after it', () => {
    expect(startOf(1000, 1010, true)).toBe(1000);
  });

  it('on native starts on the first drawn frame, so a mount hitch is not taken out of the motion', () => {
    expect(startOf(1050, 1000, false)).toBe(1050);
  });

  it('a change stamped while no frames are drawn starts on the first frame back, on web too, rather than finding the motion done', () => {
    AppState.currentState = 'background';
    expect(inBackground()).toBe(true);
    const at = stampChange();
    expect(at).toBe(Infinity);
    expect(startOf(9000, at, true)).toBe(9000);
  });

  it('a change stamped while frames are drawn is the clock\'s now', () => {
    AppState.currentState = 'active';
    const before = performance.now();
    const at = stampChange();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThan(before + 1000);
  });
});
