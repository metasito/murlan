// tests/native/feltEllipse.test.tsx — the lamp's pool is an ellipse on the
// native renderer too, not just in a browser.
//
// A radial cannot state its own ellipse in any way both platforms honour (see
// the header of components/table/felt.tsx), so the shape has to come from
// outside the gradient. Stretching the *view* around the SVG is the obvious
// way and the wrong one: react-native-svg paints at the SVG's own bounds and a
// `scaleX`/`scaleY` on a parent never reaches the paint, so the pool rendered
// as a bare disc round the seat on move on iOS — the rest of the table, the
// other seats and the player's own hand included, left in unlit room — while
// every Playwright check drew the ellipse and passed.
//
// The viewport is what both honour: a square `viewBox` in a box the shape of
// the ellipse, with `preserveAspectRatio="none"`. This asserts on the props
// react-native-svg actually hands the native side, which is the only place the
// difference is visible without a device.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import { screen, render } from '@testing-library/react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { FeltPool } from '@/components/table/felt';
import { FeltGradients } from '@/lib/tokens';

const W = 874;
const H = 402;

interface Viewport {
  /** The box the SVG paints into, in points. */
  boxW: number;
  boxH: number;
  /** …and the user space stretched into it. */
  vbW: number;
  vbH: number;
  align: string;
}

/** The two platforms name the host component differently. */
const SVG_VIEW = new Set(['RNSVGSvgView', 'RNSVGSvgViewAndroid']);

/** Every SVG viewport in the rendered tree, as the native side receives it. */
function viewports(): Viewport[] {
  const found: Viewport[] = [];
  const walk = (node: any) => {
    if (!node || typeof node === 'string') return;
    if (SVG_VIEW.has(node.type) && node.props?.vbWidth) {
      found.push({
        boxW: node.props.bbWidth,
        boxH: node.props.bbHeight,
        vbW: node.props.vbWidth,
        vbH: node.props.vbHeight,
        align: node.props.align,
      });
    }
    (node.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return found;
}

/**
 * The failing state: a viewport that cannot produce an ellipse. Either the two
 * axes are scaled together — which is every `align` but `none` — or the user
 * space already has the box's own aspect, so there is no stretch left to make.
 */
const circular = (v: Viewport[]) =>
  v.filter((p) => p.align !== 'none' || Math.abs(p.vbW / p.vbH - p.boxW / p.boxH) < 0.01);

const pool = () => (
  <FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={0.02} lightY={0.48} />
);

describe("the felt's radials are stretched by the viewport, not by a transform", () => {
  it('hands the native side a square user space in an oblong box', async () => {
    const r = await render(pool());
    const found = viewports();
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(circular(found)).toEqual([]);
    // …and the boxes are the ellipses the felt is designed around, rather than
    // squares that merely happen to differ. The vignette is the widest of them,
    // at 1.28 screens either side of the middle.
    const widest = found.reduce((a, b) => (b.boxW > a.boxW ? b : a));
    expect(Math.round(widest.boxW)).toBe(Math.round(W * 1.28 * 2));
    expect(Math.round(widest.boxH)).toBe(Math.round(H * 1.04 * 2));
    expect(widest.vbW).toBe(widest.vbH);
    await r.unmount();
  });

  // The floor. The scan reads props off the rendered tree, so it has to be
  // shown failing on the arrangement it exists to rule out — a square SVG with
  // the ellipse expressed as a scale on the view around it, which is exactly
  // what shipped and drew a disc.
  it('rejects an ellipse expressed as a transform on the view', async () => {
    const r = await render(
      <View style={{ transform: [{ scaleX: (W * 0.76 * 2) / 512 }, { scaleY: (H * 2) / 512 }] }}>
        <Svg width={512} height={512} viewBox="0 0 512 512">
          <Defs>
            <RadialGradient id="planted">
              <Stop offset={0} stopColor="#fff" stopOpacity={1} />
              <Stop offset={1} stopColor="#000" stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Rect width={512} height={512} fill="url(#planted)" />
        </Svg>
      </View>
    );
    const found = viewports();
    expect(found).toHaveLength(1);
    expect(circular(found)).toEqual(found);
    await r.unmount();
  });
});
