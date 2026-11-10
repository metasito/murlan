// tests/native/restingLoops.test.tsx — a frame callback runs only while it has something to move:
// a table at rest under reduced motion registers none, and each one wakes for its own cause.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import type { FrameInfo } from 'react-native-reanimated';

const mockControllers: { isActive: boolean; setActive(active: boolean): void }[] = [];
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    useFrameCallback: (cb: (frame: FrameInfo) => void, auto?: boolean) => {
      const controller = actual.useFrameCallback(cb, auto);
      if (!mockControllers.includes(controller)) mockControllers.push(controller);
      return controller;
    },
  };
});
const mockHops = { n: 0, ui: false };
jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual<typeof import('react-native-worklets')>('react-native-worklets');
  return {
    ...actual,
    isRNRuntime: () => !mockHops.ui,
    scheduleOnRN: (...args: Parameters<typeof actual.scheduleOnRN>) => {
      mockHops.n++;
      return actual.scheduleOnRN(...args);
    },
  };
});
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react') as typeof import('react');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return new Proxy({ Skia: call, PaintStyle: {}, rect: () => call } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key in known ? known[key] : element),
  });
});

import { makeMutable, useSharedValue } from 'react-native-reanimated';
import { TABLE_CENTRE } from '@/components/table/lampRig';
import { ParticleLayer } from '@/components/table/particleLayer';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { useLampRig } from '@/components/table/useLampRig';
import { useLinkHold } from '@/components/table/useLinkHold';
import { useDuring } from '@/lib/motion';
import type { ParticleEmitter, ParticleSpawn } from '@/components/table/particles';
import type { OwnLink } from '@/lib/ownLink';
import { FRAME_MS } from './helpers/frames';
import { setMotion } from './harness/env';

const running = () => mockControllers.filter((c) => c.isActive).length;
const frames = (n: number) => act(async () => void jest.advanceTimersByTime(n * FRAME_MS));

beforeEach(() => {
  mockControllers.length = 0;
  mockHops.n = 0;
  mockHops.ui = false;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

const DUST: ParticleSpawn = { x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, life: 1, size: 1, col: '#ffffff', shape: 'dot', glow: 0 };

function Table({ link, emitter, dim }: { link: OwnLink; emitter?: React.Ref<ParticleEmitter>; dim: boolean }) {
  const landing = useSharedValue(NO_LANDING);
  const rig = useLampRig({ pool: TABLE_CENTRE, deal: undefined, width: 874, height: 402, landing, dim });
  useLinkHold(link, rig);
  return <ParticleLayer ref={emitter} rig={rig} landing={landing} />;
}

describe('useDuring', () => {
  it('releases its callback the frame its step says no, and registers it again on a wake', async () => {
    const moving = makeMutable(true);
    const view = await renderHook(() => useDuring(() => {
      'worklet';
      return moving.value;
    }, true));
    await frames(5);
    expect(running()).toBe(1);
    moving.value = false;
    await frames(5);
    expect(running()).toBe(0);
    moving.value = true;
    await act(async () => view.result.current());
    await frames(2);
    expect(running()).toBe(1);
    await view.unmount();
  });

  it('does not run before its first wake when it starts asleep', async () => {
    const view = await renderHook(() => useDuring(() => true));
    await frames(5);
    expect(running()).toBe(0);
    await view.unmount();
  });

  it('makes no hop to wake a callback that is already running', async () => {
    const view = await renderHook(() => useDuring(() => true, true));
    await frames(5);
    const before = mockHops.n;
    mockHops.ui = true;
    await act(async () => {
      for (let i = 0; i < 50; i++) view.result.current();
    });
    await frames(5);
    expect(mockHops.n).toBe(before);
    await view.unmount();
  });

  it('registers again on a JS-side wake that arrives as the callback is about to settle', async () => {
    const moving = makeMutable(true);
    const view = await renderHook(() => useDuring(() => {
      'worklet';
      return moving.value;
    }, true));
    await frames(5);
    const setActive = jest.spyOn(mockControllers[0], 'setActive');
    moving.value = false;
    await act(async () => view.result.current());
    expect(setActive).toHaveBeenCalledWith(true);
    await view.unmount();
  });

  it('keeps a callback whose step never says no registered (the planted loop)', async () => {
    const view = await renderHook(() => useDuring(() => true, true));
    await frames(300);
    expect(running()).toBe(1);
    await view.unmount();
  });
});

describe('a table at rest under reduced motion', () => {
  it('registers no frame callback: lamp and link hold are released, and the particles have none to release', async () => {
    await setMotion('on');
    const view = await render(<Table link="up" dim={false} />);
    await frames(30);
    expect(mockControllers.length).toBe(2);
    expect(running()).toBe(0);
    await view.unmount();
  });

  it('runs the lamp and the particles while the lamp glides to a dim, then releases them', async () => {
    await setMotion('on');
    const view = await render(<Table link="up" dim={false} />);
    await frames(30);
    await view.rerender(<Table link="up" dim />);
    await frames(3);
    expect(running()).toBeGreaterThan(0);
    await frames(60 * 20);
    expect(running()).toBe(0);
    await view.unmount();
  });

  it('wakes the particles for an emit and releases them when it has faded', async () => {
    await setMotion('on');
    const emitter = React.createRef<ParticleEmitter>();
    const view = await render(<Table link="up" dim={false} emitter={emitter} />);
    await frames(30);
    expect(running()).toBe(0);
    await act(async () => emitter.current!.emit([DUST]));
    await frames(3);
    expect(running()).toBe(1);
    await frames(60 * 5);
    expect(running()).toBe(0);
    await view.unmount();
  });
});

describe('a table with motion', () => {
  it('runs the link hold through its grey ramp only', async () => {
    await setMotion('off');
    const view = await render(<Table link="up" dim={false} />);
    await frames(30);
    const link = mockControllers[1];
    expect(link.isActive).toBe(false);
    await view.rerender(<Table link="dropped" dim={false} />);
    await frames(3);
    expect(link.isActive).toBe(true);
    await frames(60 * 20);
    expect(link.isActive).toBe(false);
    await view.unmount();
  });

  it('keeps the lamp running, releases the link hold, and has no particle loop at rest', async () => {
    await setMotion('off');
    const view = await render(<Table link="up" dim={false} />);
    await frames(60);
    expect(running()).toBe(1);
    await view.unmount();
  });
});

