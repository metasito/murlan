// tests/native/browserBack.test.tsx — while the guard is on, the browser's back
// never reaches the listeners added after it (expo-router's useLinking among
// them), the URL goes forward again, and that forward is not taken for a second
// back. Only tests/e2e/online.spec.ts runs a real popstate through useLinking.
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';

type Guard = typeof import('@/lib/browserBack');

const web = globalThis as unknown as Record<string, unknown>;
const KEYS = ['history', 'addEventListener'] as const;
let saved: (readonly [string, boolean, unknown])[];
let listeners: ((e: Event) => void)[];
let forward: jest.Mock;
let guard: Guard;

function pop(): { stopped: boolean; reachedLater: boolean } {
  let stopped = false;
  const event = { stopImmediatePropagation: () => (stopped = true) } as unknown as Event;
  let reachedLater = false;
  for (const [i, fn] of listeners.entries()) {
    if (stopped) break;
    fn(event);
    if (i > 0) reachedLater = true;
  }
  return { stopped, reachedLater };
}

function Screen({ active, onBack }: { active: boolean; onBack: () => void }) {
  guard.useBrowserBackGuard(active, onBack);
  return null;
}

beforeAll(() => {
  saved = KEYS.map((k) => [k, k in web, web[k]] as const);
  listeners = [];
  web.addEventListener = (type: string, fn: (e: Event) => void) => {
    if (type === 'popstate') listeners.push(fn);
  };
  const os = jest.replaceProperty(Platform, 'OS', 'web');
  guard = require('@/lib/browserBack') as Guard;
  os.restore();
  listeners.push(jest.fn());
});

beforeEach(() => {
  forward = jest.fn();
  web.history = { forward };
});

afterAll(() => {
  for (const [k, had, v] of saved) {
    if (had) web[k] = v;
    else delete web[k];
  }
});

describe("the browser's back under the guard", () => {
  it('is taken before any later listener, goes forward again, and asks once', async () => {
    const onBack = jest.fn();
    const view = await render(<Screen active onBack={onBack} />);

    expect(pop()).toEqual({ stopped: true, reachedLater: false });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);

    expect(pop()).toEqual({ stopped: true, reachedLater: false });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);

    expect(pop().stopped).toBe(true);
    expect(forward).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it('passes back through to the router while off, and once the screen is gone', async () => {
    const onBack = jest.fn();
    const view = await render(<Screen active={false} onBack={onBack} />);
    expect(pop()).toEqual({ stopped: false, reachedLater: true });

    await view.rerender(<Screen active onBack={onBack} />);
    await view.unmount();
    expect(pop()).toEqual({ stopped: false, reachedLater: true });
    expect(forward).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
