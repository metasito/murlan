import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as nativeHaptics from '@/lib/device/hapticsEngine';
import * as webHaptics from '@/lib/device/hapticsEngine.web';
import { pulse, setHapticsGate, tap } from '@/lib/device/hapticsEngine';
import { hapticCalls, haptics, settle } from './helpers/feedback';

const sameSurface: typeof nativeHaptics = webHaptics;

describe('the haptics engine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHapticsGate(true);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('has the same surface on web and native', () => {
    expect(Object.keys(sameSurface).sort()).toEqual(Object.keys(nativeHaptics).sort());
  });

  it('maps each tap to its library type', () => {
    for (const kind of ['selection', 'light', 'medium', 'heavy', 'rigid', 'success', 'error', 'warn'] as const) tap(kind);
    expect(haptics()).toEqual([
      'selection', 'impactLight', 'impactMedium', 'impactHeavy', 'rigid',
      'notificationSuccess', 'notificationError', 'notificationWarning',
    ]);
  });

  it('a pulse fires its strength', () => {
    pulse('rigid');
    pulse('heavy');
    expect(haptics()).toEqual(['rigid', 'impactHeavy']);
  });

  it('a tap given a time fires at that time and not before', async () => {
    const at = performance.now() + 300;
    tap('light', at);
    await settle(299);
    expect(haptics()).toEqual([]);
    await settle(1);
    expect(hapticCalls()).toEqual([{ type: 'impactLight', at: expect.closeTo(at, 0) }]);
  });

  it('a tap 8 ms late fires now, and one 12 ms late is dropped', () => {
    tap('light', performance.now() - 8);
    tap('heavy', performance.now() - 12);
    expect(haptics()).toEqual(['impactLight']);
  });

  it('the gate silences taps, scheduled taps and pulses', async () => {
    setHapticsGate(false);
    tap('light');
    tap('medium', performance.now() + 100);
    pulse('rigid');
    await settle(200);
    expect(haptics()).toEqual([]);
  });
});
