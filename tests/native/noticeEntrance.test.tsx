import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { setMotionPreference } from '@/lib/accessibility';
import { NoticeText, TableNotice } from '@/components/table/TableNotice';
import { noticeRise } from '@/components/table/noticeModel';

const Pill = ({ shown }: { shown: boolean }) => (
  <TableNotice kind="hudCombo" tone="neutral" scale={1} shown={shown}>
    <NoticeText>Coppia</NoticeText>
  </TableNotice>
);

const drawn = () => {
  const style = getAnimatedStyle(screen.getByTestId('notice-hudCombo')) as {
    opacity?: number;
    transform?: Record<string, number>[];
  };
  return { opacity: style.opacity, rise: style.transform?.find((t) => 'translateY' in t)?.translateY };
};

const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(1000);
    jest.runOnlyPendingTimers();
  });

describe('a notice enters the same way every time it is shown', () => {
  afterEach(async () => {
    await act(async () => setMotionPreference('system'));
    jest.useRealTimers();
  });

  it('rises again on its second showing', async () => {
    jest.useFakeTimers();
    await act(async () => setMotionPreference('off'));
    const r = await render(<Pill shown />);
    expect(drawn()).toEqual({ opacity: 0, rise: noticeRise(1, false) });
    await settle();
    expect(drawn()).toEqual({ opacity: 1, rise: 0 });

    await r.rerender(<Pill shown={false} />);
    await settle();
    expect(drawn()).toEqual({ opacity: 0, rise: 0 });

    await r.rerender(<Pill shown />);
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    expect(drawn().rise).toBeGreaterThan(noticeRise(1, false) / 2);
    await settle();
    expect(drawn()).toEqual({ opacity: 1, rise: 0 });
    await r.unmount();
  });
});
