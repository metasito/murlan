// tests/native/slider.test.tsx — the drag itself needs a real gesture
// recognizer to prove, which only tests/e2e (Playwright) can drive. What this
// suite can see is the a11y contract #342 is built around: VoiceOver/TalkBack
// reach the control as "adjustable" with a live value, and the same
// increment/decrement path a screen reader uses is exercised directly.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Slider } from '@/components/Slider';

function Probe({
  initial,
  disabled,
}: {
  initial: number;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <Slider
      value={value}
      onValueChange={setValue}
      a11yLabel="Sound effect volume"
      valueText={`${Math.round(value * 100)}%`}
      disabled={disabled}
    />
  );
}

async function increment() {
  await act(async () => {
    fireEvent(screen.getByLabelText('Sound effect volume'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
  });
}

async function decrement() {
  await act(async () => {
    fireEvent(screen.getByLabelText('Sound effect volume'), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
  });
}

describe('Slider', () => {
  it('is reachable as an adjustable control with a live value', async () => {
    await render(<Slider value={0.65} onValueChange={() => {}} a11yLabel="Music volume" valueText="65%" />);
    const control = screen.getByLabelText('Music volume');
    // Without `accessible` a View is no element at all on iOS, and the
    // children carrying the label are hidden.
    expect(control.props.accessible).toBe(true);
    expect(control.props.accessibilityRole).toBe('adjustable');
    expect(control.props.accessibilityValue).toEqual({ min: 0, max: 1, now: 0.65, text: '65%' });
  });

  it('declares the increment/decrement actions VoiceOver drives an adjustable control with', async () => {
    await render(<Slider value={0.5} onValueChange={() => {}} a11yLabel="Music volume" valueText="50%" />);
    const names = screen.getByLabelText('Music volume').props.accessibilityActions.map(
      (a: { name: string }) => a.name
    );
    expect(names).toEqual(expect.arrayContaining(['increment', 'decrement']));
  });

  it('increment/decrement step the value and clamp at the ends', async () => {
    await render(<Probe initial={0.98} />);
    await increment();
    expect(screen.getByLabelText('Sound effect volume').props.accessibilityValue.now).toBe(1);
    await increment();
    expect(screen.getByLabelText('Sound effect volume').props.accessibilityValue.now).toBe(1);
  });

  it('decrement never drops below zero', async () => {
    await render(<Probe initial={0.02} />);
    await decrement();
    expect(screen.getByLabelText('Sound effect volume').props.accessibilityValue.now).toBe(0);
    await decrement();
    expect(screen.getByLabelText('Sound effect volume').props.accessibilityValue.now).toBe(0);
  });

  it('a stored value from an old build renders at its true position, not snapped to a preset', async () => {
    await render(<Slider value={0.42} onValueChange={() => {}} a11yLabel="Music volume" valueText="42%" />);
    expect(screen.getByLabelText('Music volume').props.accessibilityValue.now).toBe(0.42);
  });

  it('reports itself disabled and ignores the accessibility action', async () => {
    const onValueChange = jest.fn();
    await render(
      <Slider value={0.5} onValueChange={onValueChange} a11yLabel="Sound effect volume" valueText="50%" disabled />
    );
    const control = screen.getByLabelText('Sound effect volume');
    expect(control.props.accessibilityState?.disabled).toBe(true);
    await act(async () => {
      fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
