import { it, expect } from '@jest/globals';

// Unmocked on purpose: every component that plays a sound imports lib/device/sounds,
// so a native module reached at import time fails each of their test files.
it('lib/device/sounds loads without touching the expo-audio native module', () => {
  expect(() => require('@/lib/device/sounds')).not.toThrow();
});
