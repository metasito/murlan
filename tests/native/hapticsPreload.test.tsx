import { describe, it, expect, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  // Inlined rather than referencing an outer const: lib/device/feedback.ts's
  // module-init preload calls this the moment the import below is required,
  // ahead of any later statement in this file.
  default: { getItem: jest.fn(async () => JSON.stringify({ hapticsEnabled: false })) },
}));

import { hapticsEnabled, uiFeedback } from '@/lib/device/feedback';
import { haptics } from './helpers/feedback';

describe('lib/device/feedback preloads the stored preference', () => {
  it('honours a stored hapticsEnabled:false before any provider mounts', async () => {
    // Flush the microtasks the module-init .then() resolves on.
    await new Promise((resolve) => setImmediate(resolve));

    expect(hapticsEnabled()).toBe(false);

    uiFeedback('selection');
    expect(haptics()).not.toContain('selection');
  });
});
