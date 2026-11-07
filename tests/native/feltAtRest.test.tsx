// tests/native/feltAtRest.test.tsx — the felt bakes its weave once per size and only lights it after (#1962, rule 51).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { PixelRatio } from 'react-native';
import { render } from '@testing-library/react-native';import { makeMutable } from 'react-native-reanimated';

import { TABLE_AT_REST } from '@/components/table/cardRects';
import { FeltCanvas } from '@/components/table/feltCanvas';
import { FELT_K_CAP, WEAVE_PLANES } from '@/components/table/feltShader';
import { DESIGN, TABLE_CENTRE, lampControls, restingLamp, stepLamp, type Lamp } from '@/components/table/lampRig';
import type { CardTable } from '@/components/table/useCardRects';
import { FeltGradient } from '@/lib/tokens';
import { frames } from './helpers/exchangeLegs';

const mock = {
  bakes: [] as [number, number][],
  lit: 0,
  live: 0,
  images: [] as { dispose: jest.Mock; texture: boolean; dead: boolean; baked: boolean }[],
  centre: [20, 120, 60, 255] as number[] | null,
};

jest.mock('@shopify/react-native-skia', () => {
  const R = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const { jest: j } = require('@jest/globals') as typeof import('@jest/globals');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children);
  const surface = (gpu: boolean) => {
    const owned: { dead: boolean }[] = [];
    const make = (texture: boolean) => {
      const image = {
        texture,
        baked: gpu,
        dead: false,
        dispose: j.fn(),
        makeNonTextureImage: () => make(false),
        width: () => 874,
        height: () => 402,
        readPixels: () => (mock.centre ? new Uint8Array(image.dead ? [0, 0, 0, 0] : mock.centre) : null),
      };
      mock.images.push(image);
      if (texture) owned.push(image);
      return image;
    };
    return { getCanvas: () => call, flush: () => {}, dispose: () => owned.forEach((i) => (i.dead = true)), makeImageSnapshot: () => make(gpu) };
  };
  const Skia = new Proxy(call, {
    get: (_, key) =>
      key === 'Surface'
        ? { Make: () => surface(false), MakeOffscreen: (w: number, h: number) => (mock.bakes.push([w, h]), surface(true)) }
        : key === 'RuntimeEffect'
          ? { Make: (sksl: string) => ({ sksl, makeShader: () => call }) }
          : call,
  });
  const Shader = ({ source, children }: { source: { sksl: string }; children?: React.ReactNode }) => {
    const lit = source.sksl.includes('uniform shader');
    R.useEffect(() => {
      if (lit) mock.lit++;
      else mock.live++;
      return () => void (lit ? mock.lit-- : mock.live--);
    }, [lit]);
    return R.createElement(R.Fragment, null, children);
  };
  const Canvas = ({ children, style, testID }: { children?: React.ReactNode; style?: unknown; testID?: string }) =>
    R.createElement(View, { style, testID } as object, children);
  return new Proxy({ Skia, Shader, Canvas, PaintStyle: {}, FilterMode: {}, MipmapMode: {}, processUniforms: () => [], useCanvasRef: () => R.useRef(null) } as Record<string | symbol, unknown>, {
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
// The view carries no testID: on web the render counter keys the felt's canvas by its nearest one, `table-felt`.
type Node = { type: unknown; props: { style?: unknown }; parent: Node | null };
const feltView = (canvas: Node) => {
  let at = canvas.parent;
  while (at && at.type !== 'View') at = at.parent;
  return Object.assign({}, ...[at?.props.style].flat(2));
};
const planesHeld = () => mock.images.filter((i) => i.baked && !i.texture && i.dispose.mock.calls.length === 0);

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PixelRatio, 'get').mockReturnValue(2);
  mock.bakes.length = 0;
  mock.lit = 0;
  mock.live = 0;
  mock.images.length = 0;
  mock.centre = [20, 120, 60, 255];
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the felt cloth', () => {
  it('bakes its weave once and lights it, with no live cloth, through sway, a flare and a glide to a new target', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(mock.bakes).toEqual([[DESIGN.width * 2, DESIGN.height * 2]]);
    expect(planesHeld()).toHaveLength(WEAVE_PLANES);
    expect([mock.lit, mock.live]).toEqual([1, 0]);
    lamp.modify((s) => {
      'worklet';
      lampControls.flare(s, false);
      lampControls.setTarget(s, [TABLE_CENTRE[0] + 200, TABLE_CENTRE[1] - 60, TABLE_CENTRE[2]], false);
      return s;
    }, true);
    await frames(6000, sway(lamp));
    expect(mock.bakes).toHaveLength(1);
    expect([mock.lit, mock.live]).toEqual([1, 0]);
    await view.unmount();
  });

  it('bakes again for a new size, and frees the old planes', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    const first = planesHeld();
    expect(first).toHaveLength(WEAVE_PLANES);
    await view.rerender(<FeltCanvas lamp={lamp} sx={1.1} sy={1.1} stops={FeltGradient} cards={table} />);
    await frames(32);
    expect(mock.bakes).toHaveLength(2);
    expect(first.every((i) => i.dispose.mock.calls.length > 0)).toBe(true);
    expect(planesHeld()).toHaveLength(WEAVE_PLANES);
    await view.unmount();
  });

  it(`lays the canvas out at ${FELT_K_CAP} device pixels a point at most, and scales it up to the window`, async () => {
    jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    expect(mock.bakes).toEqual([[Math.round(DESIGN.width * FELT_K_CAP), Math.round(DESIGN.height * FELT_K_CAP)]]);
    const style = feltView(view.getByTestId('felt-skia'));
    expect(style.width).toBeCloseTo((DESIGN.width * FELT_K_CAP) / 3);
    expect(style.height).toBeCloseTo((DESIGN.height * FELT_K_CAP) / 3);
    expect(style.transform).toEqual([{ scale: 3 / FELT_K_CAP }]);
    expect(style.transformOrigin).toBe('left top');
    // Skia's web Canvas spreads its style into a div's CSS: one object, no RN transform.
    const canvasStyle = view.getByTestId('felt-skia').props.style;
    expect(Array.isArray(canvasStyle)).toBe(false);
    expect(canvasStyle.transform).toBeUndefined();
    await view.unmount();
  });

  it('fills the window itself under the cap', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    const style = feltView(view.getByTestId('felt-skia'));
    expect(style.transform).toBeUndefined();
    expect([style.left, style.right, style.top, style.bottom]).toEqual([0, 0, 0, 0]);
    await view.unmount();
  });

  it('keeps the live cloth when a plane comes out blank, and frees what it baked', async () => {
    mock.centre = [0, 0, 0, 0];
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(mock.bakes).toHaveLength(1);
    expect(mock.images.length).toBeGreaterThan(0);
    expect([mock.lit, mock.live]).toEqual([0, 1]);
    expect(planesHeld()).toEqual([]);
    await view.unmount();
  });

  it('holds no texture of a disposed surface as a plane', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    const held = mock.images.filter((i) => i.baked && i.dispose.mock.calls.length === 0);
    expect(held).toHaveLength(WEAVE_PLANES);
    expect(held.filter((i) => i.dead)).toEqual([]);
    expect(held.filter((i) => i.texture)).toEqual([]);
    await view.unmount();
  });

  it('keeps the planes when the build cannot read pixels back', async () => {
    mock.centre = null;
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect([mock.lit, mock.live]).toEqual([1, 0]);
    await view.unmount();
  });
});
