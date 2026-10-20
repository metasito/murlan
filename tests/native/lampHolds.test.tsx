// tests/native/lampHolds.test.tsx — the lamp's level is the lowest hold on it: the lost round's
// dim outlasts the viewer's link going lost and coming back.
import { describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import { TABLE_CENTRE } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { useLampRig } from '@/components/table/useLampRig';
import { useLinkHold } from '@/components/table/useLinkHold';
import type { OwnLink } from '@/lib/ownLink';
import { Reconnect, RoundMoment } from '@/lib/theme';

function useHeldLamp({ link, dim }: { link: OwnLink; dim: boolean }) {
  const rig = useLampRig({ pool: TABLE_CENTRE, deal: undefined, width: 874, height: 402, landing: useSharedValue(NO_LANDING), dim });
  useLinkHold(link, rig);
  return rig.lamp;
}

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
});
