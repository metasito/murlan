import { jest } from '@jest/globals';

type Listener = (state: { isConnected: boolean | null }) => void;

export function netInfoListeners(): Set<Listener> {
  const g = globalThis as { __netInfoListeners?: Set<Listener> };
  g.__netInfoListeners ??= new Set();
  return g.__netInfoListeners;
}

// The vendor's own mock, except that it keeps each listener for a test to drive: the vendor's
// `addEventListener` is a bare jest.fn that never calls back.
export function netInfoModule() {
  const vendor = jest.requireActual<Record<string, unknown>>('@react-native-community/netinfo/jest/netinfo-mock.js');
  const listeners = netInfoListeners();
  return {
    ...vendor,
    addEventListener: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
