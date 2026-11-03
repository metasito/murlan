import { afterEach, beforeEach, describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { FeltFallback } from '@/components/table/feltFallback';
import { FeltGradients } from '@/lib/tokens';
import { DESIGN, type Pool } from '@/components/table/lampRig';

const fills: number[] = [];
const canvases: { width: number; height: number }[] = [];

function fakeCanvas() {
  const cv = {
    width: 0,
    height: 0,
    getContext: (kind: string) => {
      if (kind !== '2d') return null;
      const gradient = { addColorStop: () => {} };
      return new Proxy(
        { fillRect: () => fills.push(1), createRadialGradient: () => gradient },
        { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => {}), set: () => true },
      );
    },
  };
  canvases.push(cv);
  return cv;
}

beforeEach(() => {
  const actual = React.useRef;
  jest.spyOn(React, 'useRef').mockImplementation(((init: unknown) => {
    if (init !== null) return actual(init);
    const cv = fakeCanvas();
    return { get current() { return cv; }, set current(_host: unknown) {} };
  }) as typeof React.useRef);
  fills.length = 0;
  canvases.length = 0;
  (globalThis as Record<string, unknown>).document = { createElement: () => fakeCanvas() };
  (globalThis as Record<string, unknown>).window = { devicePixelRatio: 3 };
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

const at = (x: number): Pool => [x, 400, 300];

describe('the fallback felt bake cache', () => {
  it('bakes a lamp target once, caps the backing store at DPR 2, and draws a revisit from the cache', async () => {
    const stops = FeltGradients.verde;
    const view = await render(<FeltFallback stops={stops} pool={at(100)} sx={1} sy={1} />);
    expect(fills).toHaveLength(2);
    expect(canvases[1].width).toBe(Math.round(DESIGN.width * 2));

    await view.rerender(<FeltFallback stops={stops} pool={at(200)} sx={1} sy={1} />);
    expect(fills).toHaveLength(4);
    await view.rerender(<FeltFallback stops={stops} pool={at(100)} sx={1} sy={1} />);
    expect(fills).toHaveLength(4);

    await view.rerender(<FeltFallback stops={stops} pool={at(100)} sx={2} sy={2} />);
    expect(fills).toHaveLength(6);
    await view.unmount();
  });
});
