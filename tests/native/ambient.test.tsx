import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { setMotion } from './harness/env';

const { thereAndBack, useAmbient } = require('@/lib/motion') as typeof import('@/lib/motion');

const BLINK = thereAndBack({ opacity: 0.4 }, { opacity: 1 });
const seen: { style: unknown } = { style: 'unset' };
function Looping({ on }: { on: boolean }) {
  seen.style = useAmbient(on ? { keyframes: BLINK, duration: 1000 } : null);
  return null;
}

describe('useAmbient', () => {
  it('returns nothing under reduced motion', async () => {
    await setMotion('on');
    const view = await render(<Looping on />);
    expect(seen.style).toBeUndefined();
    await view.unmount();
  });

  it('returns an endless animation style at full motion, and nothing when not asked', async () => {
    await setMotion('off');
    const view = await render(<Looping on />);
    expect(seen.style).toMatchObject({ animationName: BLINK, animationDuration: '1000ms', animationIterationCount: 'infinite' });
    await view.rerender(<Looping on={false} />);
    expect(seen.style).toBeUndefined();
    await view.unmount();
  });
});
