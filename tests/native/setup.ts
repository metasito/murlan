import { afterEach, jest } from '@jest/globals';

import { assertWholeNumbers } from './fabricIntProps';

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

// Same story for gesture-handler: GestureHandlerRootView calls into the native
// module on its first render, so mounting the app's real provider stack needs
// the vendor's own mocks.
require('react-native-gesture-handler/jestSetup');

// expo/fetch extends a native Response that does not exist here, so `import`ing
// it throws at module load — before any test runs — for every file that reaches
// lib/query-client. The platform's own fetch has the interface the app uses.
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) =>
    (globalThis.fetch as (...a: unknown[]) => unknown)(...args),
}));

/**
 * Whatever a test left on screen is checked against Fabric's integer props
 * (tests/native/fabricIntProps.ts), so a fraction that would throw while the
 * view is mounted on a device fails here instead — in whichever test rendered
 * it, without that test having to know the rule exists.
 *
 * Declared before the testing library is loaded, and jest runs `afterEach`
 * hooks in the order they were declared: the library's own auto-cleanup
 * therefore registers second and unmounts second, leaving the tree standing
 * for this to read. That ordering is the whole reason the `require` sits below
 * the hook rather than at the top of the file — and why it is not inside it,
 * since a suite that resets the module registry would then be loading the
 * library, and registering its hooks, from within a running test.
 */
afterEach(() => {
  let tree: unknown;
  try {
    tree = testingLibrary.screen.toJSON();
  } catch {
    // Nothing was rendered, so there is nothing to convert.
    return;
  }
  assertWholeNumbers(tree);
});

// Read through the module rather than destructured: `screen` is a live binding
// the library reassigns on every render, and a copy taken here would be the
// one from before the first one.
const testingLibrary = require('@testing-library/react-native') as {
  screen: { toJSON: () => unknown };
};
