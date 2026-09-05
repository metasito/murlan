import { describe, it, expect, jest } from '@jest/globals';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  // Inlined rather than referencing an outer const: lib/haptics.ts's
  // module-init preload calls this the moment the import below is required,
  // which — like tests/native/hapticsWeb.test.tsx — happens ahead of any
  // later statement in this file.
  default: { getItem: jest.fn(async () => JSON.stringify({ hapticsEnabled: false })) },
}));

import * as Haptics from 'expo-haptics';
import { hapticSelection, hapticsEnabled } from '@/lib/haptics';

const mocked = jest.mocked(Haptics);

describe('lib/haptics preloads the stored preference on web', () => {
  it('honours a stored hapticsEnabled:false before any provider mounts', async () => {
    // Flush the microtasks the module-init .then() resolves on.
    await new Promise((resolve) => setImmediate(resolve));

    expect(hapticsEnabled()).toBe(false);

    hapticSelection();
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
  });
});
