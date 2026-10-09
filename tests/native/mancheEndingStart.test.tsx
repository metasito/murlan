// tests/native/mancheEndingStart.test.tsx — the manche ending starts from the landing of the play
// that ended it, never while that play is still pending or in flight.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useMancheEnding } from '@/components/table/useMancheEnding';

interface Timeline { inFlight: boolean; landsAt: number | null; pending: () => boolean }

async function mount(timeline: Timeline) {
  const landed = jest.fn<(at: number) => void>();
  const view = await renderHook(
    (t: Timeline) => useMancheEnding({ ended: true, timeline: t, pileEmpty: false, onLanded: landed }),
    { initialProps: timeline }
  );
  return { landed, rerender: (t: Timeline) => act(async () => view.rerender(t)), unmount: () => view.unmount() };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the start of a manche ending', () => {
  it('waits for the play in flight, and starts at its landing', async () => {
    const { landed, rerender, unmount } = await mount({ inFlight: true, landsAt: null, pending: () => false });
    jest.advanceTimersByTime(300);
    await rerender({ inFlight: true, landsAt: null, pending: () => false });
    expect(landed).not.toHaveBeenCalled();

    const landsAt = performance.now();
    await rerender({ inFlight: false, landsAt, pending: () => false });
    expect(landed).toHaveBeenCalledTimes(1);
    expect(landed).toHaveBeenCalledWith(landsAt);
    await rerender({ inFlight: false, landsAt: landsAt + 50, pending: () => false });
    expect(landed).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('holds while the throw that ended it has not taken off yet', async () => {
    const { landed, rerender, unmount } = await mount({ inFlight: false, landsAt: null, pending: () => true });
    expect(landed).not.toHaveBeenCalled();
    await rerender({ inFlight: false, landsAt: null, pending: () => false });
    expect(landed).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('starts at the ending itself when the last landing was an earlier play', async () => {
    const endedAt = performance.now();
    const { landed, unmount } = await mount({ inFlight: false, landsAt: endedAt - 1000, pending: () => false });
    expect(landed).toHaveBeenCalledWith(endedAt);
    await unmount();
  });
});
