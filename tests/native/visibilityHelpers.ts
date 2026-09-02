// tests/native/visibilityHelpers.ts — `queryByText`/`getByText` alone prove a
// text node exists somewhere in the render tree, not that it draws: a node
// under `opacity: 0` still matches. `toBeVisible()` is the fix, not a
// bespoke one — it ships with `@testing-library/react-native` (registered
// globally the moment any test imports the package, via its own
// `matchers/extend-expect`) and walks the whole ancestor chain for
// `opacity: 0` / `display: none` as well as the accessibility-hidden props,
// which is what "actually visible" means for a native test.
//
// This wraps only the query half: `includeHiddenElements: true` so a hidden
// node is found and then failed for being hidden, rather than reading as
// "missing" — a different, misleading failure. Every cue that reduced motion
// (or anything else) can silently blank out reaches for this instead of
// `queryByText(...).toBeTruthy()`.
//
// Flat in tests/native/, not a subdirectory: tests/nativeScope.test.ts reads
// every entry directly under tests/native as a file.
import { expect } from "@jest/globals";
// The instance type behind every RNTL query in this codebase's installed
// version — `@testing-library/react-native` itself types `getByText` etc.
// against this, not `react-test-renderer`'s own (unrelated) type.
import type { TestInstance } from "test-renderer";

type TextScope = {
  getByText: (
    matcher: string | RegExp,
    options?: { includeHiddenElements?: boolean }
  ) => TestInstance;
};

/** The text node matching `matcher` inside `scope`, asserted to be visible —
 *  not merely present. Throws if it's missing; fails the test if it's hidden. */
export function getVisibleText(scope: TextScope, matcher: string | RegExp): TestInstance {
  const node = scope.getByText(matcher, { includeHiddenElements: true });
  expect(node).toBeVisible();
  return node;
}
