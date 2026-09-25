import { afterEach, beforeEach, describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle, makeMutable } from 'react-native-reanimated';

jest.mock('@/components/table/feltFallback', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { FeltFallback: () => <View testID="felt-fallback" /> };
});

jest.mock('@/components/table/feltSkiaBoundary', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: () => <View testID="felt-skia" /> };
});

import { Felt } from '@/components/table/feltSkia.web';
import { restingLamp } from '@/components/table/lampRig';
import { SHADE_MAX } from '@/components/table/rail';
import type { LampRig } from '@/components/table/useLampRig';
import { FeltGradients } from '@/lib/tokens';

const createElement = jest.fn(() => ({ getContext: () => null }));

beforeEach(() => {
  // A browser whose WebGL cannot draw on the GPU: the fallback is the felt for good.
  (globalThis as Record<string, unknown>).document = { createElement };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

const nextFrame = () => act(() => new Promise<void>((frame) => requestAnimationFrame(() => frame())));

describe('the web fallback felt', () => {
  it('stays where WebGL draws on the CPU, and darkens with the lamp level as the Skia felt does', async () => {
    const lamp = makeMutable(restingLamp('bottom', 0.75));
    const rig = { lamp, sx: 1, sy: 1 } as unknown as LampRig;
    const view = await render(<Felt rig={rig} stops={FeltGradients.verde} target="bottom" />);
    await nextFrame();

    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(screen.queryByTestId('felt-skia')).toBeNull();
    expect(screen.getByTestId('felt-fallback')).toBeTruthy();
    const opacity = getAnimatedStyle(screen.getByTestId('felt-level-shade')).opacity as number;
    expect(opacity).toBeCloseTo((1 - 0.75) * SHADE_MAX, 6);
    await view.unmount();
  });
});
