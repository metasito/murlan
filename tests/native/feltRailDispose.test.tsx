// tests/native/feltRailDispose.test.tsx — on native the felt frees its baked rail image when it is re-baked or unmounted.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import { TABLE_AT_REST } from '@/components/table/cardRects';
import { FeltCanvas } from '@/components/table/feltCanvas';
import { TABLE_CENTRE, restingLamp } from '@/components/table/lampRig';
import type { CardTable } from '@/components/table/useCardRects';
import { FeltGradient } from '@/lib/tokens';
import { frames } from './helpers/exchangeLegs';

const mockBaked: { dispose: jest.Mock }[] = [];
const mockDrawn: unknown[] = [];

jest.mock('@shopify/react-native-skia', () => {
  const R = require('react') as typeof import('react');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children);
  const Image = ({ image }: { image?: unknown }) => (mockDrawn.push(image ?? null), null);
  const Canvas = ({ children }: { children?: React.ReactNode }) => (mockDrawn.push('canvas'), R.createElement(R.Fragment, null, children));
  const surface = () => ({
    getCanvas: () => call,
    flush: () => {},
    dispose: () => {},
    makeImageSnapshot: () => ({
      dispose: () => {},
      makeNonTextureImage: () => {
        const image = { dispose: jest.fn() };
        mockBaked.push(image);
        return image;
      },
    }),
  });
  const Skia = new Proxy(call, { get: (_, key) => (key === 'Surface' ? { Make: surface, MakeOffscreen: () => null } : call) });
  return new Proxy({ Skia, PaintStyle: {}, useCanvasRef: () => R.useRef(null) } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key === 'Image' ? Image : key === 'Canvas' ? Canvas : key in known ? known[key] : element),
  });
});

const at = { x: 0, y: 0 };
const table = { rects: makeMutable({}), felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, motion: makeMutable(TABLE_AT_REST), pile: at, hand: at, seats: {} } as unknown as CardTable;
const felt = (sx: number) => <FeltCanvas lamp={makeMutable(restingLamp(TABLE_CENTRE))} sx={sx} sy={sx} stops={FeltGradient} cards={table} />;

beforeEach(() => {
  jest.useFakeTimers();
  mockBaked.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the felt rail on native', () => {
  it('bakes the rail with its first frame, disposes the old image on a re-bake and the last one on unmount', async () => {
    const view = await render(felt(1));
    expect(mockBaked.map((image) => image.dispose.mock.calls.length)).toEqual([0]);
    await view.rerender(felt(1.5));
    expect(mockBaked.map((image) => image.dispose.mock.calls.length)).toEqual([1, 0]);
    await frames(32);
    expect(mockBaked.map((image) => image.dispose.mock.calls.length)).toEqual([1, 0]);
    await view.unmount();
    expect(mockBaked.map((image) => image.dispose.mock.calls.length)).toEqual([1, 1]);
  });

  it('draws the baked rail in the render that mounts the felt, not after an effect', async () => {
    mockDrawn.length = 0;
    await render(felt(2));
    expect(mockDrawn.slice(0, 2)).toEqual(['canvas', mockBaked[mockBaked.length - 1]]);
  });
});
