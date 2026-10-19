import { jest } from '@jest/globals';

/** Answers `fetch` with `stub` until tests/native/setup.ts restores mocks after the test. */
export function stubFetch(stub: unknown): void {
  jest.spyOn(globalThis as { fetch: unknown }, 'fetch', 'get').mockReturnValue(stub);
}
