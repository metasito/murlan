// tests/native/seatDiscLit.test.tsx — the seat on move's disc takes the lantern mockup's
// `.seat.on .disc`: a border at rgba(243,224,166,.7) and a 14 px glow at .35 (#1264).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SEAT_DISC } from '@/components/seatLayout';
import { mockupPx } from '@/components/table/noticeModel';
import { bootFeedback } from './helpers/feedback';
import { PAIR, tableAfter } from './helpers/landing';

describe('the seat on move', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("lights its disc with the mockup's border and glow", async () => {
    const view = await render(tableAfter({ by: 0, combo: PAIR, turn: 2 }));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    const disc = StyleSheet.flatten(within(view.getByTestId('top-seat')).getByTestId('seat-disc').props.style);
    const scale = Number(disc.width) / SEAT_DISC;
    expect([disc.borderColor, disc.boxShadow]).toEqual([
      'rgba(243,224,166,0.7)',
      `0px 0px ${mockupPx(14, scale)}px rgba(243,224,166,0.35)`,
    ]);
    await view.unmount();
  });
});
