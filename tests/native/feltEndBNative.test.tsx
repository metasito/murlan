import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import { makeMutable } from 'react-native-reanimated';

const given: { Ends?: unknown }[] = [];
jest.mock('@/components/table/feltCanvas', () => ({
  FeltCanvas: (props: { Ends?: unknown }) => {
    given.push(props);
    return null;
  },
}));

import { Felt } from '@/components/table/feltSkia';
import { EndBNative } from '@/components/table/feltEndBNative';
import { TABLE_CENTRE, restingLamp, steppedLamp } from '@/components/table/lampRig';
import type { LampRig } from '@/components/table/useLampRig';
import type { CardTable } from '@/components/table/useCardRects';
import type { EndsProps } from '@/components/table/feltCanvas';
import { FeltGradients } from '@/lib/tokens';

describe('the native felt at rest', () => {
  it('lays end B over the felt', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const rig = { lamp, now: steppedLamp(lamp).now, sx: 1, sy: 1 } as unknown as LampRig;
    const view = await render(<Felt rig={rig} stops={FeltGradients.verde} pool={TABLE_CENTRE} ready onReady={() => {}} cards={{} as CardTable} />);
    expect(given.at(-1)?.Ends).toBe(EndBNative);
    await view.unmount();
  });

  it('holds the felt at end A while the lamp rests, and lets it draw live the moment the lamp moves', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const side = makeMutable(0);
    const settle = makeMutable(0);
    const draw = jest.fn(() => <View testID="felt-end-b" />);
    const props = { lamp, now: steppedLamp(lamp).now, settle, content: makeMutable(0), side, host: { current: null }, canvas: { current: null }, draw } as unknown as EndsProps;
    const view = await render(<EndBNative {...props} />);
    await waitFor(() => expect(side.value).toBe(-1));
    expect(draw).toHaveBeenCalled();

    await act(async () => {
      lamp.value = { ...lamp.value, tx: lamp.value.tx + 100 };
    });
    expect(side.value).toBe(0);
    await view.unmount();
  });
});
