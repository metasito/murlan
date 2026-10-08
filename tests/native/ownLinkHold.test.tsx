import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react-native';
import { useOwnLink } from '@/lib/useOwnLink';
import { useLinkHold } from '@/components/table/useLinkHold';
import type { OwnLink } from '@/lib/ownLink';
import { Reconnect } from '@/lib/theme';

let mockReduceMotion = false;
jest.mock('@/lib/accessibility', () => ({ usePrefersReducedMotion: () => mockReduceMotion }));
const mockReaders: Record<string, () => number> = {};
jest.mock('@/lib/e2eTrace', () => ({
  ...jest.requireActual<object>('@/lib/e2eTrace'),
  useTraceSource: (field: string, read: () => number) => {
    mockReaders[field] = read;
  },
}));

function fakeSocket(connected: boolean) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    connected,
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: () => void) {
      listeners.get(event)?.delete(fn);
    },
    flip(to: boolean) {
      this.connected = to;
      for (const fn of listeners.get(to ? 'connect' : 'disconnect') ?? []) fn();
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

const wait = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

describe("the viewer's own link", () => {
  it('walks drop, reconnecting, give-up and back on the socket and the clock', async () => {
    const socket = fakeSocket(true);
    const { result, unmount } = await renderHook(() => useOwnLink(socket));
    expect(result.current).toBe('up');
    await act(async () => socket.flip(false));
    expect(result.current).toBe('dropped');
    await wait(Reconnect.pillAfter);
    expect(result.current).toBe('reconnecting');
    await wait(Reconnect.giveUp - Reconnect.pillAfter);
    expect(result.current).toBe('lost');
    await act(async () => socket.flip(true));
    expect(result.current).toBe('back');
    await wait(Reconnect.back);
    expect(result.current).toBe('up');
    await unmount();
  });

  it('never holds a table whose socket was never up', async () => {
    const socket = fakeSocket(false);
    const { result, unmount } = await renderHook(() => useOwnLink(socket));
    await wait(Reconnect.giveUp);
    expect(result.current).toBe('up');
    await unmount();
  });
});

describe('the table holding its breath', () => {
  it('freezes on the drop, dims on give-up, and lets go on the way back', async () => {
    const rig = { freeze: jest.fn<(amount: number) => void>(), setLevel: jest.fn<(to: number, rate: number) => void>() };
    const { result, rerender, unmount } = await renderHook(({ link }: { link: OwnLink }) => useLinkHold(link, rig), {
      initialProps: { link: 'up' },
    });
    expect(result.current.frozen).toBe(false);
    await rerender({ link: 'dropped' });
    expect(rig.freeze).toHaveBeenLastCalledWith(1);
    expect(result.current.frozen).toBe(true);
    await rerender({ link: 'lost' });
    expect(rig.setLevel).toHaveBeenLastCalledWith(Reconnect.lamp, Reconnect.lampRate);
    await rerender({ link: 'back' });
    expect(rig.freeze).toHaveBeenLastCalledWith(0);
    expect(rig.setLevel).toHaveBeenLastCalledWith(1, Reconnect.lampRate);
    expect(result.current.frozen).toBe(false);
    await unmount();
  });

  it('dims a table that mounts already given up, and lets it go on the way back', async () => {
    const rig = { freeze: jest.fn<(amount: number) => void>(), setLevel: jest.fn<(to: number, rate: number) => void>() };
    const { rerender, unmount } = await renderHook(({ link }: { link: OwnLink }) => useLinkHold(link, rig), {
      initialProps: { link: 'lost' },
    });
    expect(rig.setLevel).toHaveBeenLastCalledWith(Reconnect.lamp, Reconnect.lampRate);
    await rerender({ link: 'back' });
    expect(rig.setLevel).toHaveBeenLastCalledWith(1, Reconnect.lampRate);
    expect(rig.setLevel).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('never touches the lamp level of a table that mounts with its link up', async () => {
    const rig = { freeze: jest.fn<(amount: number) => void>(), setLevel: jest.fn<(to: number, rate: number) => void>() };
    const { unmount } = await renderHook(() => useLinkHold('up', rig));
    expect(rig.setLevel).not.toHaveBeenCalled();
    await unmount();
  });

  it('holds the clock on the way back until the missed cards have landed, however late they come', async () => {
    const rig = { freeze: jest.fn<(amount: number) => void>(), setLevel: jest.fn<(to: number, rate: number) => void>() };
    const { result, rerender, unmount } = await renderHook(
      ({ link, missed }: { link: OwnLink; missed: boolean }) => useLinkHold(link, rig, missed),
      { initialProps: { link: 'reconnecting', missed: false } }
    );
    await rerender({ link: 'back', missed: true });
    expect(rig.freeze).toHaveBeenLastCalledWith(0);
    expect(result.current.frozen).toBe(true);
    await rerender({ link: 'back', missed: false });
    expect(result.current.frozen).toBe(false);
    await rerender({ link: 'up', missed: true });
    expect(result.current.frozen).toBe(true);
    await unmount();
  });

  const holdGrey = async (reduced: boolean) => {
    mockReduceMotion = reduced;
    const rig = { freeze: jest.fn<(amount: number) => void>(), setLevel: jest.fn<(to: number, rate: number) => void>() };
    const view = await renderHook(({ link }: { link: OwnLink }) => useLinkHold(link, rig), { initialProps: { link: 'up' } });
    const seen: number[] = [];
    await view.rerender({ link: 'dropped' });
    seen.push(mockReaders.grey());
    await view.rerender({ link: 'back' });
    seen.push(mockReaders.grey());
    mockReduceMotion = false;
    await view.unmount();
    return seen;
  };

  it('fades the grey over frames, so none of it shows before the first one', async () => {
    expect(await holdGrey(false)).toEqual([0, 0]);
  });

  it('applies and removes the grey at once under reduced motion', async () => {
    expect(await holdGrey(true)).toEqual([Reconnect.grey, 0]);
  });
});
