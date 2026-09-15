// Whatever asks a screen reader to speak, in either platform's spelling. Read
// off the rendered tree rather than through `*ByLabelText` or `*ByRole`, which
// match no node whose label is empty — and a region saying nothing is the state
// the a11y tests have to tell apart from no region at all.
//
// Reachability is deliberately not asked here: a veiled region is still a
// region, and whether it is withdrawn by its own props or an ancestor's is
// `isHiddenFromAccessibility`'s question, at the call site that means it.
import type { RenderResult } from '@testing-library/react-native';

type Element = RenderResult['container'];

export function isLiveRegion(node: Element): boolean {
  return node.props.accessibilityLiveRegion === 'polite' || node.props['aria-live'] === 'polite';
}

export function liveRegions(screen: Pick<RenderResult, 'container'>): Element[] {
  return screen.container.queryAll(isLiveRegion);
}
