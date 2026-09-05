import { describe, it, expect, jest } from '@jest/globals';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const mockStoredRaw = JSON.stringify({ hapticsEnabled: false });
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => mockStoredRaw) },
}));

// lib/haptics.ts's module-init preload runs the instant it is required, before
// any inline statement following an import — so the module under test has to
// be required inside jest.isolateModules, after the mocks above are already
// in place, rather than via a static top-level import.
describe('lib/haptics preloads the stored preference on web', () => {
  it('honours a stored hapticsEnabled:false before any provider mounts', async () => {
    let hapticSelection: () => unknown;
    let hapticsEnabled: () => boolean;
    jest.isolateModules(() => {
      const mod = require('@/lib/haptics');
      hapticSelection = mod.hapticSelection;
      hapticsEnabled = mod.hapticsEnabled;
    });

    // Flush the microtasks the module-init .then() resolves on.
    await new Promise((resolve) => setImmediate(resolve));

    expect(hapticsEnabled!()).toBe(false);

    const Haptics = require('expo-haptics');
    hapticSelection!();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });
});
