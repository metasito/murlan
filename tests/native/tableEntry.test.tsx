// tests/native/tableEntry.test.tsx — the table breathes in and its lamp settles
// as the player sits down (#1102).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { FeltPool } from '@/components/table/felt';
import { setMotionPreference } from '@/lib/accessibility';
import { FeltGradients } from '@/lib/tokens';
import { motionMs } from '@/lib/theme';

const W = 874;
const H = 402;
const LAMP = { x: 0.5, y: 0.48 };
const LAMP_SWING_MS = 900;

const live = (id: string) => getAnimatedStyle(screen.getByTestId(id)) as { opacity?: number; top?: number };

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    jest.runOnlyPendingTimers();
  });
}

describe('sitting down at the table', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    setMotionPreference('system');
    jest.useRealTimers();
  });

  it('opens dim with the lamp above its mark, then lights up and settles onto it', async () => {
    setMotionPreference('off');
    const r = await render(<FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={LAMP.x} lightY={LAMP.y} />);

    expect(live('felt-breath').opacity).toBeGreaterThan(0);
    expect(live('felt-lamp-anchor').top).toBeLessThan(LAMP.y * H - 1);

    await advance(Math.max(motionMs('reveal', false), LAMP_SWING_MS));
    expect(live('felt-breath').opacity).toBe(0);
    expect(live('felt-lamp-anchor').top).toBeCloseTo(LAMP.y * H, 0);

    await r.unmount();
  });

  it('under reduced motion, only fades up, over the reduced reveal', async () => {
    setMotionPreference('on');
    const r = await render(<FeltPool width={W} height={H} stops={FeltGradients.verde} lightX={LAMP.x} lightY={LAMP.y} />);
    await advance(0);
    expect(live('felt-lamp-anchor').top).toBeCloseTo(LAMP.y * H, 0);

    await advance(motionMs('reveal', true));
    expect(live('felt-breath').opacity).toBe(0);

    await r.unmount();
  });
});
