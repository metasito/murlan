// tests/native/feltAtRest.test.tsx — the felt bakes its weave once per size, lights it while the lamp moves,
// and a settled lamp's sway costs it no lighting (#1962, rule 51).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { PixelRatio } from 'react-native';
import { render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import { TABLE_AT_REST } from '@/components/table/cardRects';
import { FeltCanvas } from '@/components/table/feltCanvas';
import { FELT_K_CAP, WEAVE_PLANES } from '@/components/table/feltShader';
import { DESIGN, TABLE_CENTRE, lampControls, restingLamp, stepLamp, type Lamp } from '@/components/table/lampRig';
import type { CardTable } from '@/components/table/useCardRects';
import { FeltGradient } from '@/lib/tokens';
import { frames } from './helpers/exchangeLegs';

type Kind = 'weave' | 'lit' | 'cloth' | '';
const mock = {
  bakes: [] as { size: [number, number]; kind: Kind }[],
  drawing: '' as Kind,
  rest: 0,
  lit: 0,
  live: 0,
  images: [] as { dispose: jest.Mock; texture: boolean; dead: boolean; baked: boolean; kind: Kind }[],
  centre: [20, 120, 60, 255] as number[] | null,
  blank: '' as Kind,
  over: '' as 'lit' | 'cloth' | '',
  settled: null as { value: { uW: number } } | null,
};

jest.mock('@shopify/react-native-skia', () => {
  const R = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const { jest: j } = require('@jest/globals') as typeof import('@jest/globals');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children);
  const surface = (gpu: boolean, bake?: { kind: Kind }) => {
    const owned: { dead: boolean }[] = [];
    const make = (texture: boolean) => {
      if (bake && texture) bake.kind = mock.drawing;
      const image = {
        texture,
        baked: gpu,
        kind: gpu ? mock.drawing : ('' as Kind),
        dead: false,
        dispose: j.fn(),
        makeNonTextureImage: () => make(false),
        makeShaderOptions: () => call,
        width: () => 874,
        height: () => 402,
        readPixels: () => (mock.centre ? new Uint8Array(image.dead || (mock.blank && image.kind === mock.blank) ? [0, 0, 0, 0] : mock.centre) : null),
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
        ? { Make: () => surface(false), MakeOffscreen: (w: number, h: number) => {
              const bake = { size: [w, h] as [number, number], kind: '' as Kind };
              mock.bakes.push(bake);
              return surface(true, bake);
            } }
        : key === 'RuntimeEffect'
          ? {
              Make: (sksl: string) => ({
                sksl,
                makeShader: () => ((mock.drawing = sksl.includes('uPlane') ? 'weave' : 'cloth'), call),
                makeShaderWithChildren: () => ((mock.drawing = sksl.includes('uG0') ? 'lit' : ''), call),
              }),
            }
          : call,
  });
  const Shader = ({ source, uniforms, children }: { source: { sksl: string }; uniforms?: unknown; children?: React.ReactNode }) => {
    const kind = source.sksl.includes('uLean') ? 'rest' : source.sksl.includes('uG0') ? 'lit' : 'live';
    if (kind === 'rest') {
      mock.over = source.sksl.includes('uG0') ? 'lit' : 'cloth';
      mock.settled = uniforms as typeof mock.settled;
    }
    R.useEffect(() => {
      mock[kind]++;
      return () => void mock[kind]--;
    }, [kind]);
    return R.createElement(R.Fragment, null, children);
  };
  const Canvas = ({ children, style, testID }: { children?: React.ReactNode; style?: unknown; testID?: string }) =>
    R.createElement(View, { style, testID } as object, children);
  return new Proxy({ Skia, Shader, Canvas, PaintStyle: {}, FilterMode: {}, MipmapMode: {}, processUniforms: () => [], useCanvasRef: () => R.useRef(null) } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key in known ? known[key] : element),
  });
});

// On a device the UI thread's word reaches React frames later; under Jest both flush in the same act.
const REACT_LAGS_MS = 48;
jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as Record<string, unknown>;
  return { ...actual, scheduleOnRN: (run: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(() => run(...args), REACT_LAGS_MS) };
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
const held = (kind: Kind) => mock.images.filter((i) => i.baked && i.kind === kind && !i.texture && i.dispose.mock.calls.length === 0);
const planesHeld = () => held('weave');
const bakes = (kind: Kind) => mock.bakes.filter((b) => b.kind === kind).map((b) => b.size);
const drawn = () => ({ rest: mock.rest, lit: mock.lit, live: mock.live });
const unfreed = () => mock.images.filter((i) => i.baked && i.dispose.mock.calls.length === 0);
// The weight of the lit cloth over the settled cross on each frame the cross is drawn, as the lamp sways.
const watch = (lamp: ReturnType<typeof makeMutable<Lamp>>) => {
  const seen: (number | null)[] = [];
  const each = () => {
    sway(lamp)();
    seen.push(mock.rest ? (mock.settled?.value.uW ?? null) : null);
  };
  return { seen, each };
};
const steps = (seen: (number | null)[]) => seen.slice(1).map((w, i) => (w === null || seen[i] === null ? 0 : Math.abs(w - (seen[i] as number))));
const flare = (lamp: ReturnType<typeof makeMutable<Lamp>>) =>
  lamp.modify((s) => {
    'worklet';
    lampControls.flare(s, false);
    return s;
  }, true);
// The cloth lit at either end of the lamp's sway, crossed by where the lamp is.
const LIT_PER_TARGET = 2;
const settle = (lamp: ReturnType<typeof makeMutable<Lamp>>, pool: readonly [number, number, number]) =>
  lamp.modify((s) => {
    'worklet';
    lampControls.setTarget(s, [pool[0], pool[1], pool[2]], false);
    return s;
  }, true);

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PixelRatio, 'get').mockReturnValue(2);
  mock.bakes.length = 0;
  mock.drawing = '';
  mock.rest = 0;
  mock.lit = 0;
  mock.live = 0;
  mock.images.length = 0;
  mock.centre = [20, 120, 60, 255];
  mock.blank = '';
  mock.over = '';
  mock.settled = null;
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the felt cloth', () => {
  it('bakes its weave once, and a settled lamp lights two cloths once and only crosses them while it sways', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(bakes('weave')).toEqual([[DESIGN.width * 2, DESIGN.height * 2]]);
    expect(planesHeld()).toHaveLength(WEAVE_PLANES);
    expect(bakes('lit')).toEqual(Array(LIT_PER_TARGET).fill([DESIGN.width * 2, DESIGN.height * 2]));
    expect(held('lit')).toHaveLength(LIT_PER_TARGET);
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    await frames(1600, sway(lamp));
    expect(mock.bakes).toHaveLength(1 + LIT_PER_TARGET);
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    await view.unmount();
  });

  it('hands the lit cloth over to the settled cross in a ramp, from the frame the cross is drawn', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const { seen, each } = watch(lamp);
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(1000, each);
    const drawnAt = seen.findIndex((w) => w !== null);
    expect(seen[drawnAt]).toBe(1);
    expect(seen.at(-1)).toBe(0);
    expect(Math.max(...steps(seen))).toBeLessThan(0.1);
    expect(seen.slice(drawnAt).every((w, i, all) => w !== null && (i === 0 || w <= (all[i - 1] as number)))).toBe(true);
    await view.unmount();
  });

  it('ramps a flare up and back down over the same two cloths, lighting nothing else', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(1000, sway(lamp));
    expect(mock.settled?.value.uW).toBe(0);
    const { seen, each } = watch(lamp);
    flare(lamp);
    await frames(160, each);
    expect(seen.every((w) => w !== null)).toBe(true);
    expect(seen[0]).toBeLessThan(0.5);
    expect(seen.at(-1)).toBe(1);
    expect(Math.max(...steps(seen))).toBeLessThan(0.5);
    seen.length = 0;
    await frames(3200, each);
    expect(seen.at(-1)).toBe(0);
    expect(Math.max(...steps(seen))).toBeLessThan(0.05);
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    expect(mock.bakes).toHaveLength(1 + LIT_PER_TARGET);
    await view.unmount();
  });

  it('draws no frame of the old cross once the lamp moves on', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(1000, sway(lamp));
    const { seen, each } = watch(lamp);
    settle(lamp, [TABLE_CENTRE[0] + 200, TABLE_CENTRE[1] - 60, TABLE_CENTRE[2]]);
    await frames(160, each);
    expect(seen.filter((w) => w !== null && w < 1)).toEqual([]);
    await view.unmount();
  });

  it('lights the planes while the lamp glides, lights two cloths once it settles, and keeps those it lit before', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    settle(lamp, [TABLE_CENTRE[0] + 200, TABLE_CENTRE[1] - 60, TABLE_CENTRE[2]]);
    await frames(160, sway(lamp));
    expect(drawn()).toEqual({ rest: 0, lit: 1, live: 0 });
    await frames(6000, sway(lamp));
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    expect(bakes('weave')).toHaveLength(1);
    expect(bakes('lit')).toHaveLength(2 * LIT_PER_TARGET);
    settle(lamp, TABLE_CENTRE);
    await frames(6000, sway(lamp));
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    expect(bakes('lit')).toHaveLength(2 * LIT_PER_TARGET);
    await view.unmount();
  });

  it('bakes again once a new size holds still, drawing the live cloth meanwhile, and frees the old planes', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    const first = planesHeld();
    expect(first).toHaveLength(WEAVE_PLANES);
    await view.rerender(<FeltCanvas lamp={lamp} sx={1.05} sy={1.05} stops={FeltGradient} cards={table} />);
    await frames(96, sway(lamp));
    await view.rerender(<FeltCanvas lamp={lamp} sx={1.1} sy={1.1} stops={FeltGradient} cards={table} />);
    await frames(96, sway(lamp));
    expect(bakes('weave')).toHaveLength(1);
    expect(drawn()).toEqual({ rest: 0, lit: 0, live: 1 });
    await frames(400, sway(lamp));
    expect(bakes('weave')).toEqual([
      [DESIGN.width * 2, DESIGN.height * 2],
      [Math.round(DESIGN.width * 2.2), Math.round(DESIGN.height * 2.2)],
    ]);
    expect(first.every((i) => i.dispose.mock.calls.length > 0)).toBe(true);
    expect(planesHeld()).toHaveLength(WEAVE_PLANES);
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    await view.unmount();
  });

  it(`lays the canvas out at ${FELT_K_CAP} device pixels a point at most, and scales it up to the window`, async () => {
    jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(32);
    expect(bakes('weave')).toEqual([[Math.round(DESIGN.width * FELT_K_CAP), Math.round(DESIGN.height * FELT_K_CAP)]]);
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

  it('crosses two cloths lit in one pass when a plane comes out blank, and frees the planes', async () => {
    mock.blank = 'weave';
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(bakes('weave')).toHaveLength(1);
    expect(planesHeld()).toEqual([]);
    expect(bakes('cloth')).toHaveLength(LIT_PER_TARGET);
    expect(held('cloth')).toHaveLength(LIT_PER_TARGET);
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    expect(mock.over).toBe('cloth');
    await view.unmount();
  });

  it('keeps the live cloth when every bake comes out blank, and frees what it baked', async () => {
    mock.centre = [0, 0, 0, 0];
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(mock.images.length).toBeGreaterThan(0);
    expect(drawn()).toEqual({ rest: 0, lit: 0, live: 1 });
    expect(unfreed()).toEqual([]);
    await view.unmount();
  });

  it('frees every bake when it unmounts', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(mock.over).toBe('lit');
    expect(unfreed().length).toBeGreaterThan(0);
    await view.unmount();
    await frames(64);
    expect(unfreed()).toEqual([]);
  });

  it('holds no texture of a disposed surface as a plane or a lit cloth', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    const kept = mock.images.filter((i) => i.baked && i.dispose.mock.calls.length === 0);
    expect(kept).toHaveLength(WEAVE_PLANES + LIT_PER_TARGET);
    expect(kept.filter((i) => i.dead)).toEqual([]);
    expect(kept.filter((i) => i.texture)).toEqual([]);
    await view.unmount();
  });

  it('keeps its bakes when the build cannot read pixels back', async () => {
    mock.centre = null;
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const view = await render(<FeltCanvas lamp={lamp} sx={1} sy={1} stops={FeltGradient} cards={table} />);
    await frames(160, sway(lamp));
    expect(drawn()).toEqual({ rest: 1, lit: 0, live: 0 });
    await view.unmount();
  });
});
