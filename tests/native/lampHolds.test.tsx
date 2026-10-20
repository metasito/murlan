// tests/native/lampHolds.test.tsx — the lamp's level is the lowest hold on it: the lost round's
// dim outlasts the viewer's link going lost and coming back.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { TABLE_CENTRE } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { useLampRig } from '@/components/table/useLampRig';
import { useLinkHold } from '@/components/table/useLinkHold';
import type { OwnLink } from '@/lib/ownLink';
import { Reconnect, RoundMoment } from '@/lib/theme';

type Deal = { offsetMs: number; clock: SharedValue<number> } | undefined;

function useHeldLamp({ link, dim, deal }: { link: OwnLink; dim: boolean; deal?: Deal }) {
  const rig = useLampRig({ pool: TABLE_CENTRE, deal, width: 874, height: 402, landing: useSharedValue(NO_LANDING), dim });
  useLinkHold(link, rig);
  return rig.lamp;
}

afterEach(() => {
  jest.useRealTimers();
});

describe('the holds on the lamp level', () => {
  it('keeps a lost round dim through the link going lost and coming back up', async () => {
    const view = await renderHook(useHeldLamp, { initialProps: { link: 'up' as OwnLink, dim: true } });
    expect(view.result.current.get().lvlT).toBe(RoundMoment.lostLevel);
    await view.rerender({ link: 'lost', dim: true });
    expect(view.result.current.get().lvlT).toBe(Reconnect.lamp);
    await view.rerender({ link: 'up', dim: true });
    expect(view.result.current.get().lvlT).toBe(RoundMoment.lostLevel);
    await view.rerender({ link: 'up', dim: false });
    expect(view.result.current.get().lvlT).toBe(1);
    await view.unmount();
  });

  it('keeps the link dim through the next round lifting a lost one', async () => {
    const view = await renderHook(useHeldLamp, { initialProps: { link: 'lost' as OwnLink, dim: true } });
    await view.rerender({ link: 'lost', dim: false });
    expect(view.result.current.get().lvlT).toBe(Reconnect.lamp);
    await view.unmount();
  });

  it('starts a deal under a lost link at the link\'s level, never brighter', async () => {
    jest.useFakeTimers();
    const view = await renderHook(useHeldLamp, { initialProps: { link: 'lost' as OwnLink, dim: false, deal: undefined as Deal } });
    await act(async () => void jest.advanceTimersByTime(20_000));
    expect(view.result.current.get().lvl).toBeCloseTo(Reconnect.lamp, 3);
    await view.rerender({ link: 'lost', dim: false, deal: { offsetMs: 0, clock: makeMutable(0) } });
    expect(view.result.current.get().lvlT).toBe(Reconnect.lamp);
    expect(view.result.current.get().lvl).toBeLessThanOrEqual(Reconnect.lamp + 1e-3);
    await view.unmount();
  });
});
