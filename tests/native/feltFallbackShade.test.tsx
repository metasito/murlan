import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { getAnimatedStyle, makeMutable } from 'react-native-reanimated';

jest.mock('@/components/table/feltFallback', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { FeltFallback: () => <View testID="felt-fallback" /> };
});

import { Felt } from '@/components/table/feltSkia.web';
import { restingLamp } from '@/components/table/lampRig';
import { SHADE_MAX } from '@/components/table/rail';
import type { LampRig } from '@/components/table/useLampRig';
import { FeltGradients } from '@/lib/tokens';

describe('the web fallback felt', () => {
  it('darkens with the lamp level, as the Skia felt does', async () => {
    const lamp = makeMutable(restingLamp('bottom', 0.75));
    const rig = { lamp, sx: 1, sy: 1 } as unknown as LampRig;
    const view = await render(<Felt rig={rig} stops={FeltGradients.verde} target="bottom" />);

    expect(screen.getByTestId('felt-fallback')).toBeTruthy();
    const opacity = getAnimatedStyle(screen.getByTestId('felt-level-shade')).opacity as number;
    expect(opacity).toBeCloseTo((1 - 0.75) * SHADE_MAX, 6);
    await view.unmount();
  });
});
