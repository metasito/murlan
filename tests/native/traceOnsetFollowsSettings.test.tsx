import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockTraceOnset = jest.fn();
const mockPlayer = {
  volume: 0,
  seekTo: jest.fn(),
  setPlaybackRate: jest.fn(),
  play: jest.fn(),
  remove: jest.fn(),
};

jest.mock('@/lib/e2eTrace', () => ({
  traceOnset: (...args: unknown[]) => mockTraceOnset(...args),
}));
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockPlayer),
  setAudioModeAsync: jest.fn(async () => {}),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

import { setHapticsMasterEnabled, hapticLight } from '@/lib/device/haptics';
import { setSoundsMasterEnabled, setSoundsMasterVolume, playCardPlay } from '@/lib/device/sounds';

describe('the E2E trace records an onset only for an effect that fires', () => {
  beforeEach(() => {
    mockTraceOnset.mockClear();
    setHapticsMasterEnabled(true);
    setSoundsMasterEnabled(true);
    setSoundsMasterVolume(1);
  });

  it('records a haptic and a sound that fire', async () => {
    hapticLight();
    await playCardPlay();
    expect(mockTraceOnset.mock.calls).toEqual([
      ['haptic', 'hapticLight'],
      ['sound', 'play'],
    ]);
  });

  it('records nothing with haptics off', () => {
    setHapticsMasterEnabled(false);
    hapticLight();
    expect(mockTraceOnset).not.toHaveBeenCalled();
  });

  it('records nothing with sounds off', async () => {
    setSoundsMasterEnabled(false);
    await playCardPlay();
    expect(mockTraceOnset).not.toHaveBeenCalled();
  });

  it('records nothing at zero volume', async () => {
    setSoundsMasterVolume(0);
    await playCardPlay();
    expect(mockTraceOnset).not.toHaveBeenCalled();
  });
});
