// tests/native/feltStops.test.tsx — the felt's gradients are still translucent
// once react-native-svg's *native* path has finished with them.
//
// `extractGradient.ts` builds every stop as `(color & 0x00ffffff) | (alpha << 24)`,
// where `alpha` comes from `stopOpacity` and defaults to 1. A stop that carries
// its alpha inside `stopColor` — `rgba(0,0,0,0)` — therefore arrives fully
// opaque on iOS and Android, while a browser draws it exactly as written.
//
// That is not a subtle difference here: the vignette is one rect over the whole
// felt, so both its stops turning opaque black painted the entire table out on
// device while every Playwright check stayed green. This runs on the same
// module graph the app ships to a phone, which is the only place it is visible.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { screen, render } from '@testing-library/react-native';
import { FeltPool } from '@/components/table/felt';
import { FeltGradients, Lantern } from '@/lib/tokens';

/** The alpha byte react-native-svg packed into a stop, 0…255. */
const alphaOf = (packed: number) => (packed >>> 24) & 0xff;

/** `[offset, packedColor]` pairs for the named gradient, as the native side gets them. */
function gradientStops(name: string): [number, number][] {
  const found: [number, number][] = [];
  const walk = (node: any) => {
    if (!node || typeof node === 'string') return;
    if (node.props?.name === name && Array.isArray(node.props?.gradient)) {
      const flat: number[] = node.props.gradient;
      for (let i = 0; i < flat.length; i += 2) found.push([flat[i], flat[i + 1]]);
    }
    (node.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return found;
}

const felt = () => (
  <FeltPool
    width={844}
    height={390}
    stops={FeltGradients.verde}
    lightX={0.5}
    lightY={0.98}
  />
);

/** The alpha a token asks for, as a byte. */
function tokenAlpha(rgba: string): number {
  const a = /rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(rgba);
  return Math.round((a ? Number(a[1]) : 1) * 255);
}

describe('the felt reaches the native renderer with its alpha intact', () => {
  it('does not paint the vignette as an opaque black sheet over the table', async () => {
    const r = await render(felt());

    const stops = gradientStops('feltVignette');
    expect(stops).toHaveLength(2);

    const [[, clear], [, rim]] = stops;
    expect(alphaOf(clear)).toBe(tokenAlpha(Lantern.vignetteClear));
    expect(alphaOf(rim)).toBe(tokenAlpha(Lantern.vignette));
    // The failure this exists for: both ends opaque, so the rect is a black wall.
    expect(alphaOf(clear)).toBeLessThan(alphaOf(rim));

    await r.unmount();
  });

  it('keeps the lamp translucent, so the cloth under it still shows', async () => {
    const r = await render(felt());

    for (const [name, token] of [
      ['feltCore', Lantern.core],
      ['feltBloom', Lantern.bloom],
    ] as const) {
      const [[, head]] = gradientStops(name);
      expect(alphaOf(head)).toBe(tokenAlpha(token));
      expect(alphaOf(head)).toBeLessThan(255);
    }

    // …and each of those ends at nothing rather than at an opaque wash.
    for (const name of ['feltCore', 'feltBloom']) {
      const stops = gradientStops(name);
      expect(alphaOf(stops[stops.length - 1][1])).toBe(0);
    }

    await r.unmount();
  });

  it('leaves the cloth itself opaque — the felt is not a translucent sheet', async () => {
    const r = await render(felt());

    for (const [, packed] of gradientStops('feltField')) {
      expect(alphaOf(packed)).toBe(255);
    }

    await r.unmount();
  });
});

// The floor. The packing above is read out of a real render, so a check that
// only ever passes because the scan stopped finding the gradient would pass
// silently — this fails if `gradientStops` returns nothing, and proves the
// alpha check can tell an opaque stop from a translucent one.
describe('the check can see the defect it exists for', () => {
  it('finds the gradients at all, and reads their alpha', async () => {
    const r = await render(felt());

    expect(gradientStops('feltVignette').length).toBeGreaterThan(0);
    expect(gradientStops('feltField').length).toBeGreaterThan(0);
    expect(gradientStops('nothingIsNamedThis')).toEqual([]);

    // 0xFF000000 is what an alpha-in-the-colour stop packs to, and 0x00000000
    // what a correctly-split transparent one does.
    expect(alphaOf(0xff000000)).toBe(255);
    expect(alphaOf(0x00000000)).toBe(0);

    await r.unmount();
  });
});
