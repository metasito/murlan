// tests/native/feltTranslate.test.tsx — the lamp's anchor moves to a new
// lamp point on rerender, not just at mount, and the gradients that make up
// the pool stay structurally attached to that anchor rather than painting
// wherever they last were. See felt.tsx's header for why the anchor moves by
// `left`/`top`, not `transform`.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { FeltPool } from '@/components/table/felt';
import { FeltGradients } from '@/lib/tokens';

const W = 874;
const H = 402;
// BESNIK and LUAN — two of lightPosition()'s (components/gameTableModel.ts)
// off-viewer fractions, on opposite sides of the table.
const BESNIK = { x: 0.02, y: 0.48 };
const LUAN = { x: 0.98, y: 0.48 };
/** Comfortably past felt.tsx's own LAMP_MS swing, so withTiming has settled. */
const SETTLE_MS = 900;

/** The two platforms name the SVG host component differently. */
const SVG_VIEW = new Set(['RNSVGSvgView', 'RNSVGSvgViewAndroid']);

function findByTestId(node: unknown, testID: string): any {
  if (!node || typeof node === 'string') return null;
  const n = node as { props?: { testID?: string }; children?: unknown[] };
  if (n.props?.testID === testID) return n;
  for (const child of n.children ?? []) {
    const found = findByTestId(child, testID);
    if (found) return found;
  }
  return null;
}

/** How many SVG hosts render anywhere under `node`, at any depth. */
function svgViewCount(node: unknown): number {
  if (!node || typeof node === 'string') return 0;
  const n = node as { type?: string; children?: unknown[] };
  const own = SVG_VIEW.has(n.type ?? '') ? 1 : 0;
  return own + (n.children ?? []).reduce((sum: number, c) => sum + svgViewCount(c), 0);
}

/**
 * `props.style` freezes the animated entry at whichever render first mounted
 * it, so it cannot be read for the live position — but its *position in the
 * array* is real. `jestInlineStyle` is that same array with the animated
 * entry removed rather than replaced, which is enough to tell which slot in
 * `style` is the live one: whichever entry's content isn't present in
 * `jestInlineStyle` (content, not reference — Reanimated's own props
 * filtering does not preserve object identity between the two props, even
 * for an untouched static entry). Reading the style array's own order —
 * rather than assuming the animated entry always wins regardless of where it
 * sits, as `getAnimatedStyle` and an earlier version of this helper both did
 * — is what makes this catch a style array that stops applying the animated
 * entry last.
 */
function anchorStyle() {
  const { props } = screen.getByTestId('felt-lamp-anchor');
  const flatten = (s: unknown, into: Record<string, unknown>[]) => {
    if (Array.isArray(s)) s.forEach((e) => flatten(e, into));
    else if (s) into.push(s as Record<string, unknown>);
  };
  const full: Record<string, unknown>[] = [];
  flatten(props.style, full);
  const staticEntries: Record<string, unknown>[] = [];
  flatten(props.jestInlineStyle, staticEntries);
  const staticContent = new Set(staticEntries.map((e) => JSON.stringify(e)));

  let merged: Record<string, unknown> = {};
  for (const entry of full) {
    const live = staticContent.has(JSON.stringify(entry))
      ? entry
      : (props.jestAnimatedStyle?.value ?? {});
    merged = { ...merged, ...live };
  }
  return merged;
}

describe('the lamp pool moves by left/top, and the gradients move with it', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lands the anchor at the lamp’s own point, and moves it again on rerender', async () => {
    const r = await render(
      <FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={BESNIK.x} lightY={BESNIK.y} />
    );
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });

    let style = anchorStyle();
    expect(style.left).toBeCloseTo(BESNIK.x * W, 0);
    expect(style.top).toBeCloseTo(BESNIK.y * H, 0);
    expect(style.transform).toBeUndefined();

    // The field, core and bloom radials hang off the anchor so that moving
    // it moves what it paints. The weave and the vignette are the two SVGs
    // in the tree that deliberately do not — 5 in total, 3 under the anchor.
    let anchorNode = findByTestId(screen.toJSON(), 'felt-lamp-anchor');
    expect(svgViewCount(anchorNode)).toBe(3);

    // The turn passes to the seat opposite. If the value driving the anchor
    // stopped updating — the frozen-lamp failure this ticket also reported —
    // this is the assertion that catches it: a mount-only snapshot cannot.
    await act(async () => {
      r.rerender(
        <FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={LUAN.x} lightY={LUAN.y} />
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_MS);
    });

    style = anchorStyle();
    expect(style.left).toBeCloseTo(LUAN.x * W, 0);
    expect(style.top).toBeCloseTo(LUAN.y * H, 0);

    anchorNode = findByTestId(screen.toJSON(), 'felt-lamp-anchor');
    expect(svgViewCount(anchorNode)).toBe(3);

    await r.unmount();
  });

  // The floor for the structural check above: gradients rendered as the
  // anchor's siblings rather than its children are exactly #209's symptom
  // (the anchor's frame moved while the gradients kept painting at the
  // origin) — reproduced directly, since felt.tsx has no such switch to flip.
  it('rejects gradients that render beside the anchor instead of inside it', async () => {
    function DetachedAnchor() {
      const x = useSharedValue(BESNIK.x * W);
      const y = useSharedValue(BESNIK.y * H);
      const style = useAnimatedStyle(() => ({ left: x.value, top: y.value }));
      return (
        <View>
          <Animated.View
            testID="felt-lamp-anchor"
            style={[{ position: 'absolute', width: 0, height: 0 }, style]}
          />
          <Svg width={10} height={10}>
            <Defs>
              <RadialGradient id="stray">
                <Stop offset={0} stopColor="#fff" stopOpacity={1} />
                <Stop offset={1} stopColor="#000" stopOpacity={1} />
              </RadialGradient>
            </Defs>
            <Rect width={10} height={10} fill="url(#stray)" />
          </Svg>
        </View>
      );
    }

    const r = await render(<DetachedAnchor />);
    const anchorNode = findByTestId(screen.toJSON(), 'felt-lamp-anchor');
    expect(svgViewCount(anchorNode)).toBe(0);
    await r.unmount();
  });

  // The floor for `anchorStyle()` itself: a style array that puts the static
  // base after the animated entry — the precedence #209's construction must
  // not regress into — has to read as the static entry winning, the way a
  // real style array resolves it, not as the animated one winning regardless
  // of position.
  it('rejects a static entry that follows the animated one in the style array', async () => {
    function ReorderedAnchor() {
      const x = useSharedValue(BESNIK.x * W);
      const y = useSharedValue(BESNIK.y * H);
      const style = useAnimatedStyle(() => ({ left: x.value, top: y.value }));
      return (
        <Animated.View
          testID="felt-lamp-anchor"
          style={[style, { position: 'absolute', left: 0, top: 0, width: 0, height: 0 }]}
        />
      );
    }

    const r = await render(<ReorderedAnchor />);
    const style = anchorStyle();
    expect(style.left).toBe(0);
    expect(style.top).toBe(0);
    await r.unmount();
  });
});
