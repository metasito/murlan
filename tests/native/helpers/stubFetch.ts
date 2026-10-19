import { jest } from '@jest/globals';

/** Answers `fetch` with `stub` until tests/native/setup.ts restores mocks after the test. */
export function stubFetch(stub: unknown): void {
  if (Object.getOwnPropertyDescriptor(globalThis, 'fetch')?.get) {
    jest.spyOn(globalThis as { fetch: unknown }, 'fetch', 'get').mockReturnValue(stub);
  } else {
    jest.spyOn(globalThis as { fetch: (...args: unknown[]) => unknown }, 'fetch').mockImplementation(stub as (...args: unknown[]) => unknown);
  }
}
