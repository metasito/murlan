// tests/native/dealFirstFrame.test.tsx — a deal whose clock is already past its end shows as an instant deal, not a hang (#1624).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import { DealFlights } from '@/components/table/deal';
import { FRAME_MS } from './helpers/frames';

describe('DealFlights', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lands on its first frame when handed a clock already past its end', async () => {
    const onLanded = jest.fn();
    const clock = makeMutable(5_000);
    const view = await render(<DealFlights cards={[]} scale={1} clock={clock} startMs={0} endMs={1_000} onStarted={() => {}} onLanded={onLanded} />);
    expect(onLanded).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(FRAME_MS));
    expect(onLanded).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(FRAME_MS * 10));
    expect(onLanded).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('lands once, on the frame its clock crosses the end', async () => {
    const onLanded = jest.fn();
    const clock = makeMutable(-1);
    const view = await render(<DealFlights cards={[]} scale={1} clock={clock} startMs={0} endMs={200} onStarted={() => {}} onLanded={onLanded} />);
    await act(async () => jest.advanceTimersByTime(FRAME_MS * 6));
    expect(onLanded).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(FRAME_MS * 20));
    expect(onLanded).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
