// tests/native/workletsUiQueue.test.tsx — UI jobs run in the order they were scheduled, whichever timer turn scheduled them
// (patches/react-native-worklets+0.13.0.patch): a frame's `setActive(false)` must never land after a later wake's `true`.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { scheduleOnUI } from 'react-native-worklets';

describe('the UI queue under jest', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a job scheduled during a timer turn before one scheduled after that turn', () => {
    const ran: string[] = [];
    setTimeout(() => scheduleOnUI(() => ran.push('during the turn')), 0);
    jest.advanceTimersByTime(0);
    scheduleOnUI(() => ran.push('after the turn'));
    jest.advanceTimersByTime(5);
    expect(ran).toEqual(['during the turn', 'after the turn']);
  });
});
