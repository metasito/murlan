import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import * as Haptics from 'expo-haptics';
import { setHapticsMasterEnabled, hapticSelection, hapticLight } from '@/lib/haptics';

const mocked = jest.mocked(Haptics);

// expo-haptics' web shim calls navigator.vibrate() per style — real on Android
// web, an inert no-op where the Vibration API doesn't exist (iOS/desktop
// Safari). lib/haptics.ts's guard() must let that call through on web rather
// than short-circuiting before it, so Android web haptics are not blocked at
// this layer.
describe('lib/haptics on web', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHapticsMasterEnabled(true);
  });

  it('reaches expo-haptics when the master toggle is on', () => {
    hapticSelection();
    hapticLight();
    expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('still honours the master toggle on web', () => {
    setHapticsMasterEnabled(false);
    hapticSelection();
    hapticLight();
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
    expect(mocked.impactAsync).not.toHaveBeenCalled();
  });
});
