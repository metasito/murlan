import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { View, type ViewStyle } from 'react-native';
import { makeMutable, type SharedValue } from 'react-native-reanimated';
import { getAnimatedStyle } from './harness/animatedStyle';

const given: { Ends?: unknown }[] = [];
jest.mock('@/components/table/feltCanvas', () => ({
  FeltCanvas: (props: { Ends?: unknown }) => {
    given.push(props);
    return null;
  },
}));
// Reanimated's test renderer drops an Animated.View's CSS animation props, so the sway is read where it is made.
const sways: (ViewStyle | undefined)[] = [];
jest.mock('@/lib/motion', () => {
  const actual = jest.requireActual<typeof import('@/lib/motion')>('@/lib/motion');
  return {
    ...actual,
    useAmbient: (spec: Parameters<typeof actual.useAmbient>[0]) => {
      const style = actual.useAmbient(spec);
      sways.push(style);
      return style;
    },
  };
});

import { Felt } from '@/components/table/feltSkia';
import { EndBNative } from '@/components/table/feltEndBNative';
import { SWAY, TABLE_CENTRE, restingLamp, steppedLamp } from '@/components/table/lampRig';
import { endLamp, type Shown } from '@/components/table/restEnds';
import type { LampRig } from '@/components/table/useLampRig';
import type { CardTable } from '@/components/table/useCardRects';
import type { EndsProps } from '@/components/table/feltCanvas';
import { FeltGradients } from '@/lib/tokens';

const settling = () => {
  const lamp = makeMutable(restingLamp(TABLE_CENTRE));
  const side = makeMutable(0);
  const settle = makeMutable(1);
  const drawn: SharedValue<Shown>[] = [];
  const draw = jest.fn((view: SharedValue<Shown>) => {
    drawn.push(view);
    return <View testID="felt-end-b" />;
  });
  const props = { lamp, now: steppedLamp(lamp).now, settle, content: makeMutable(0), side, host: { current: null }, canvas: { current: null }, draw } as unknown as EndsProps;
  return { lamp, side, settle, draw, drawn, props };
};

const opacity = () => (getAnimatedStyle(screen.getByTestId('felt-end-b-layer', { includeHiddenElements: true })) as { opacity?: number }).opacity;
const canvas = () => screen.queryByTestId('felt-end-b', { includeHiddenElements: true });

describe('the native felt at rest', () => {
  it('lays end B over the felt', async () => {
    const lamp = makeMutable(restingLamp(TABLE_CENTRE));
    const rig = { lamp, now: steppedLamp(lamp).now, sx: 1, sy: 1 } as unknown as LampRig;
    const view = await render(<Felt rig={rig} stops={FeltGradients.verde} pool={TABLE_CENTRE} ready onReady={() => {}} cards={{} as CardTable} />);
    expect(given.at(-1)?.Ends).toBe(EndBNative);
    await view.unmount();
  });

  it('draws nothing until the felt has crossed to its ends, then shows end B swaying over end A', async () => {
    const { lamp, side, settle, draw, drawn, props } = settling();
    const view = await render(<EndBNative {...props} />);
    expect(draw).not.toHaveBeenCalled();
    expect(canvas()).toBeNull();
    expect(opacity()).toBe(0);
    expect(sways.at(-1)).toBeUndefined();

    await act(async () => {
      settle.value = 0;
    });
    await waitFor(() => expect(side.value).toBe(-1));
    expect(opacity()).toBe(1);
    expect(canvas()).not.toBeNull();
    const sway = sways.at(-1) as Record<string, unknown>;
    expect(sway.animationName).toBeDefined();
    expect(sway.animationIterationCount).toBe('infinite');
    expect(drawn.at(-1)!.value).toEqual(endLamp(lamp.value, SWAY));
    await view.unmount();
  });

  it('gives the felt back the moment the lamp moves, and lets go of end B', async () => {
    const { lamp, side, settle, props } = settling();
    settle.value = 0;
    const view = await render(<EndBNative {...props} />);
    await waitFor(() => expect(side.value).toBe(-1));
    expect(opacity()).toBe(1);

    // Asserted before React has run, which lets go of end B only after a round trip to the JS thread.
    lamp.value = { ...lamp.value, tx: lamp.value.tx + 100 };
    expect(side.value).toBe(0);
    await waitFor(() => expect(opacity()).toBe(0));
    await waitFor(() => expect(canvas()).toBeNull());
    expect(sways.at(-1)).toBeUndefined();
    await view.unmount();
  });
});
