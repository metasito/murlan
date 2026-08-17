import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import * as Haptics from 'expo-haptics';
import {
  setHapticsMasterEnabled,
  hapticsEnabled,
  hapticSelection,
  hapticLight,
  hapticMedium,
  hapticHeavy,
  hapticSuccess,
  hapticError,
  hapticWarn,
} from '@/lib/haptics';

const mocked = jest.mocked(Haptics);

// expo-haptics has no meaningful web behaviour, so the settings toggle that
// silences it is only ever real on a device. These cover the native branch of
// lib/haptics.ts, which the web suite cannot reach.
describe('lib/haptics honours the master toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHapticsMasterEnabled(true);
  });

  it('fires on native when enabled', () => {
    hapticSelection();
    hapticLight();
    hapticSuccess();
    expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(mocked.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
  });

  it('goes silent when the setting is off', () => {
    setHapticsMasterEnabled(false);
    hapticSelection();
    hapticLight();
    hapticMedium();
    hapticHeavy();
    hapticSuccess();
    hapticError();
    hapticWarn();
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
    expect(mocked.impactAsync).not.toHaveBeenCalled();
    expect(mocked.notificationAsync).not.toHaveBeenCalled();
  });

  it('reports the current state', () => {
    setHapticsMasterEnabled(false);
    expect(hapticsEnabled()).toBe(false);
    setHapticsMasterEnabled(true);
    expect(hapticsEnabled()).toBe(true);
  });
});
