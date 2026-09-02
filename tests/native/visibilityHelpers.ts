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
import { StyleSheet } from "react-native";
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

/**
 * `toBeVisible()` walks the ancestor chain for `opacity: 0`, `display: none`
 * and the accessibility-hidden props, but not a `transform` that scales a
 * node to nothing — a style claim just as real, and just as capable of
 * blanking a cue silently. Width, height and off-screen position are left
 * to `tests/e2e/`: `react-test-renderer` never runs flexbox, so no native
 * test can say where a node actually lands. Colour matching its own
 * background is left out for the same reason in reverse — the background is
 * frequently inherited, gradient-drawn or otherwise not a prop this tree
 * exposes, so a native test cannot answer it generically; that class of
 * defect is `tests/contrast.test.ts`'s job.
 */
function hasZeroScale(node: TestInstance | null): boolean {
  for (let n = node; n; n = n.parent) {
    const style = StyleSheet.flatten(n.props.style) as
      | { transform?: { scale?: number; scaleX?: number; scaleY?: number }[] }
      | undefined;
    if (!Array.isArray(style?.transform)) continue;
    if (style.transform.some((step) => step.scale === 0 || step.scaleX === 0 || step.scaleY === 0)) {
      return true;
    }
  }
  return false;
}

/** The text node matching `matcher` inside `scope`, asserted to be visible —
 *  not merely present. Throws if it's missing; fails the test if it's hidden
 *  or scaled to zero. */
export function getVisibleText(scope: TextScope, matcher: string | RegExp): TestInstance {
  const node = scope.getByText(matcher, { includeHiddenElements: true });
  expect(node).toBeVisible();
  if (hasZeroScale(node)) {
    throw new Error(`${String(matcher)} matched a node scaled to zero by a transform on itself or an ancestor`);
  }
  return node;
}
