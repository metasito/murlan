import { afterEach, jest } from '@jest/globals';

import { assertWholeNumbers } from './fabricIntProps';

// Reanimated v4 drives animations from worklets on the UI thread. Under Jest
// there is no UI thread, so its own test shim stands in and makes withTiming &c
// resolve synchronously. Without it every component that animates throws on
// render rather than reporting a real failure.
require('react-native-reanimated').setUpTests?.();

// Each UI job here is its own setTimeout, so a test that swaps back to real timers drops a
// frame callback's queued registration and then runs its unregistration against nothing.
type FrameRegistry = { frameCallbackRegistry: Map<number, unknown>; manageStateFrameCallback(id: number, on: boolean): void };
let frameRegistry: FrameRegistry | undefined;
Object.defineProperty(globalThis, '_frameCallbackRegistry', {
  configurable: true,
  get: () => frameRegistry,
  set(registry: FrameRegistry) {
    const manage = registry.manageStateFrameCallback;
    registry.manageStateFrameCallback = function (this: FrameRegistry, id, on) {
      if (this.frameCallbackRegistry.has(id)) manage.call(this, id, on);
    };
    frameRegistry = registry;
  },
});

// AsyncStorage is a native module with no JS fallback; its own in-memory mock
// is the vendor-supported substitute.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Same story for gesture-handler: GestureHandlerRootView calls into the native
// module on its first render, so mounting the app's real provider stack needs
// the vendor's own mocks.
require('react-native-gesture-handler/jestSetup');
// Under Jest worklets is its web build, which has no UI runtime to hand over.
jest.mock('react-native-gesture-handler/lib/module/handlers/gestures/installUIRuntimeBindings', () =>
  require('react-native-gesture-handler/lib/module/handlers/gestures/installUIRuntimeBindings.web')
);
// Stands in for app/_layout.tsx's GestureHandlerRootView around every test.
jest.mock('react-native-gesture-handler/lib/module/GestureHandlerRootViewContext', () => ({
  __esModule: true,
  default: require('react').createContext(true),
}));
// A Modal is its own native window, outside that root: what it holds needs its own.
jest.mock('@/components/AppModal', () => {
  const React = require('react') as typeof import('react');
  const { AppModal } = jest.requireActual<typeof import('@/components/AppModal')>('@/components/AppModal');
  const RootContext = require('react-native-gesture-handler/lib/module/GestureHandlerRootViewContext').default;
  return {
    AppModal: (props: React.ComponentProps<typeof AppModal>) =>
      React.createElement(AppModal, props, React.createElement(RootContext, { value: false }, props.children)),
  };
});

// Skia is a native renderer with nothing to draw into here, and its own mock needs CanvasKit
// loaded by a test environment of its own. The felt carries no game information (#1244), so
// every drawing call stands in as a no-op and every element renders only its children.
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react') as typeof import('react');
  const call: object = new Proxy(function () {}, {
    get: (_, key) => (key === 'then' ? undefined : call),
    apply: () => call,
  });
  const element = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return new Proxy({ Skia: call, PaintStyle: {} } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key in known ? known[key] : element),
  });
});

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
