import { jest } from '@jest/globals';

/**
 * The module a `jest.mock('@/lib/e2eConfig', ...)` hands back to a suite that switches the e2e build on and
 * off between tests: a bundle reads the flag once, so each test here stands for a different build, read
 * from `process.env` as the suite sets it.
 */
export function e2eConfigAsBuilt() {
  const actual = jest.requireActual<typeof import('@/lib/e2eConfig')>('@/lib/e2eConfig');
  // defineProperty, not a getter in a spread: the transform turns a spread into Object.assign, which reads it once.
  return Object.defineProperty({ ...actual }, 'E2E_FAST', {
    enumerable: true,
    get: () => process.env.EXPO_PUBLIC_E2E_FAST === '1',
  });
}
