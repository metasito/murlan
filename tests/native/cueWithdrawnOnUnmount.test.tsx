// tests/native/cueWithdrawnOnUnmount.test.tsx — a motion that sends its cue ahead takes it back when it
// leaves the table before the cue starts: a new deal or a closed screen does not sound the old one.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { event } from '@/lib/device/feedback';
import { DealFlights } from '@/components/table/deal';
import { Legs, frames, trade } from './helpers/exchangeLegs';
import { bootFeedback, settle, sounds } from './helpers/feedback';

describe('a cue sent ahead', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is taken back when the trade leaves the table before its first leg shows', async () => {
    const view = await render(<Legs trade={trade()} />);
    await frames(32);
    await settle();
    expect(sounds()).toContain('exchange');
    await view.unmount();
    await settle(2000);
    expect(sounds()).not.toContain('exchange');
  });

  it('is taken back when the deal leaves the table before its first card', async () => {
    const view = await render(
      <DealFlights cards={[]} scale={1} clock={makeMutable(-1)} startMs={500} endMs={3000} onStarted={(at) => event([{ kind: 'deal' }], at)} onLanded={() => {}} />
    );
    await frames(32);
    await settle();
    expect(sounds()).toContain('deal');
    await view.unmount();
    await settle(2000);
    expect(sounds()).not.toContain('deal');
  });
});
