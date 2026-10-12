import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import 'react-native-reanimated';

describe('the frame clock every native test runs on', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a frame per 16 ms of fake time, as a 60 Hz display does', () => {
    const frames: number[] = [];
    requestAnimationFrame(() => frames.push(1));
    jest.advanceTimersByTime(1);
    requestAnimationFrame(() => frames.push(2));
    jest.advanceTimersByTime(1);
    expect(frames).toEqual([]);

    jest.advanceTimersByTime(14);
    expect(frames).toEqual([1]);
    jest.advanceTimersByTime(1);
    expect(frames).toEqual([1, 2]);
  });

  it('runs about sixty frames of a second-long frame loop, not a thousand', () => {
    let frames = 0;
    const loop = () => {
      frames += 1;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    jest.advanceTimersByTime(1000);
    expect(frames).toBe(62);
  });
});
