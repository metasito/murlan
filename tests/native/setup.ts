import { jest } from '@jest/globals';

// Reanimated v4 drives animations from worklets on the UI thread. Under Jest
// there is no UI thread, so its own test shim stands in and makes withTiming &c
// resolve synchronously. Without it every component that animates throws on
// render rather than reporting a real failure.
require('react-native-reanimated').setUpTests?.();

// AsyncStorage is a native module with no JS fallback; its own in-memory mock
// is the vendor-supported substitute.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
