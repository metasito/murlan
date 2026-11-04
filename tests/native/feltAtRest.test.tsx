// tests/native/feltAtRest.test.tsx — a settled lamp's sway costs the felt no cloth raster (#1962, rule 51).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import { TABLE_AT_REST } from '@/components/table/cardRects';
import { FeltCanvas } from '@/components/table/feltCanvas';
import { TABLE_CENTRE, lampControls, restingLamp, stepLamp, type Lamp } from '@/components/table/lampRig';
import type { CardTable } from '@/components/table/useCardRects';
import { FeltGradient } from '@/lib/tokens';
import { frames } from './helpers/exchangeLegs';

const mock = { clothBakes: 0, liveCloth: 0, images: [] as { dispose: jest.Mock }[], centre: [20, 120, 60, 255] as number[] | null };

jest.mock('@shopify/react-native-skia', () => {
  const R = require('react') as typeof import('react');
  const { jest: j } = require('@jest/globals') as typeof import('@jest/globals');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children);
  const surface = () => ({
    getCanvas: () => call,
    flush: () => {},
    dispose: () => {},
    makeImageSnapshot: () => {
      const image = { dispose: j.fn(), makeNonTextureImage: () => image, width: () => 874, height: () => 402, readPixels: () => (mock.centre ? new Uint8Array(mock.centre) : null) };
      mock.images.push(image);
      return image;
    },
  });
  const Skia = new Proxy(call, {
    get: (_, key) =>
      key === 'Surface'
        ? { Make: surface, MakeOffscreen: () => (mock.clothBakes++, surface()) }
        : call,
  });
  const Shader = ({ children }: { children?: React.ReactNode }) => {
    R.useEffect(() => {
      mock.liveCloth++;
      return () => void mock.liveCloth--;
    }, []);
    return R.createElement(R.Fragment, null, children);
  };
  return new Proxy({ Skia, Shader, PaintStyle: {}, processUniforms: () => [], useCanvasRef: () => R.useRef(null) } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key in known ? known[key] : element),
  });
});

const at = { x: 0, y: 0 };
const table = { rects: makeMutable({}), felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, motion: makeMutable(TABLE_AT_REST), pile: at, hand: at, seats: {} } as unknown as CardTable;
const sway = (lamp: ReturnType<typeof makeMutable<Lamp>>) => () =>
  lamp.modify((s) => {
    'worklet';
    stepLamp(s, 1 / 60, false);
    return s;
  }, true);

beforeEach(() => {
  jest.useFakeTimers();
  mock.clothBakes = 0;
  mock.liveCloth = 0;
  mock.images.length = 0;
  mock.centre = [20, 120, 60, 255];
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the felt cloth at rest', () => {
  it('bakes once and draws no live cloth while the lamp only sways', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    const baked = mock.clothBakes;
    expect(baked).toBe(1);
    expect(mock.liveCloth).toBe(0);
    await frames(1600, sway(lamp));
    expect(mock.clothBakes).toBe(baked);
    expect(mock.liveCloth).toBe(0);
    await view.unmount();
  });

  it('keeps the baked cloth through a landing flare', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    lamp.modify((s) => {
      'worklet';
      lampControls.flare(s, false);
      return s;
    }, true);
    await frames(3200, sway(lamp));
    expect(mock.clothBakes).toBe(1);
    expect(mock.liveCloth).toBe(0);
    await view.unmount();
  });

  it('goes live while the lamp glides to a new target and bakes once it settles there', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    lamp.modify((s) => {
      'worklet';
      lampControls.setTarget(s, [TABLE_CENTRE[0] + 200, TABLE_CENTRE[1] - 60, TABLE_CENTRE[2]], false);
      return s;
    }, true);
    await frames(160, sway(lamp));
    expect(mock.liveCloth).toBe(1);
    await frames(6000, sway(lamp));
    expect(mock.liveCloth).toBe(0);
    expect(mock.clothBakes).toBe(2);
    await view.unmount();
  });

  it('keeps the live cloth when a bake comes out blank, and frees the blank image', async () => {
    mock.centre = [0, 0, 0, 0];
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(mock.clothBakes).toBeGreaterThan(0);
    expect(mock.images.length).toBeGreaterThan(0);
    expect(mock.liveCloth).toBe(1);
    expect(mock.images[mock.images.length - 1].dispose).toHaveBeenCalled();
    await view.unmount();
  });

  it('keeps the baked cloth when the build cannot read pixels back', async () => {
    mock.centre = null;
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(mock.liveCloth).toBe(0);
    await view.unmount();
  });
});
