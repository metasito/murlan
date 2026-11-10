import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import { setMotion } from './harness/env';

const { thereAndBack, useAmbient } = require('@/lib/motion') as typeof import('@/lib/motion');

const BLINK = thereAndBack({ opacity: 0.4 }, { opacity: 1 });
function Looping({ on }: { on: boolean }) {
  const style = useAmbient(on ? { keyframes: BLINK, duration: 1000 } : null);
  return <View testID="looping" style={style} />;
}
const styleOf = (view: Awaited<ReturnType<typeof render>>) => view.getByTestId('looping').props.style;

describe('useAmbient', () => {
  it('returns nothing under reduced motion', async () => {
    await setMotion('on');
    const view = await render(<Looping on />);
    expect(styleOf(view)).toBeUndefined();
    await view.unmount();
  });

  it('returns an endless animation style at full motion, and nothing when not asked', async () => {
    await setMotion('off');
    const view = await render(<Looping on />);
    expect(styleOf(view)).toMatchObject({ animationName: BLINK, animationDuration: '1000ms', animationIterationCount: 'infinite' });
    await view.rerender(<Looping on={false} />);
    expect(styleOf(view)).toBeUndefined();
    await view.unmount();
  });
});
