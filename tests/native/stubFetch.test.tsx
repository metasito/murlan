// tests/native/stubFetch.test.tsx — the fetch stub takes, and gives back, whichever
// shape of `fetch` the environment installed.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { stubFetch } from './helpers/stubFetch';

const host = globalThis as unknown as { fetch: () => string };
const original = Object.getOwnPropertyDescriptor(host, 'fetch');

afterEach(() => {
  if (original) Object.defineProperty(host, 'fetch', original);
});

describe('stubFetch', () => {
  const real = () => 'real';
  const stub = () => 'stub';

  it.each([
    ['an accessor', { get: () => real, configurable: true }],
    ['a data property', { value: real, writable: true, configurable: true }],
  ])('stubs and restores fetch installed as %s', (_shape, descriptor) => {
    Object.defineProperty(host, 'fetch', descriptor);
    stubFetch(stub);
    expect(host.fetch()).toBe('stub');
    jest.restoreAllMocks();
    expect(host.fetch).toBe(real);
  });
});
