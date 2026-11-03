// A UI job runs on the next timer turn, as on a device: patches/react-native-worklets+0.13.0.patch.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { runOnUIAsync, scheduleOnUI } from 'react-native-worklets';
import { FRAME_MS } from './helpers/frames';

describe('a job sent to the UI thread', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs on the next timer turn, not an animation frame later', async () => {
    const t0 = performance.now();
    const ran: number[] = [];
    scheduleOnUI(() => {
      'worklet';
      ran.push(performance.now() - t0);
    });
    await jest.advanceTimersByTimeAsync(FRAME_MS);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toBeLessThan(FRAME_MS / 2);
  });

  it('runs each job in the order sent, and answers runOnUIAsync with its result', async () => {
    const order: string[] = [];
    scheduleOnUI(() => {
      'worklet';
      order.push('a');
    });
    const answer = runOnUIAsync(() => {
      'worklet';
      order.push('b');
      return 7;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['a', 'b']);
    await expect(answer).resolves.toBe(7);
  });
});
