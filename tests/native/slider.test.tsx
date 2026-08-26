// tests/native/slider.test.tsx — the drag itself needs a real gesture
// recognizer to prove, which only tests/e2e (Playwright) can drive. What this
// suite can see is the a11y contract #342 is built around: VoiceOver/TalkBack
// reach the control as "adjustable" with a live value, and the same
// increment/decrement path a screen reader uses is exercised directly.
//
// `accessibilityValue`'s three numbers are `int` in Fabric
// (ReactCommon/react/renderer/components/view/AccessibilityPrimitives.h), and
// the conversion that enforces that runs in C++ while mounting the view — so
// no renderer here ever performs it. `everyNumberIsWhole` stands in for it.
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

/** What Fabric will accept: `min`, `max` and `now` are `int` on the other side. */
function everyNumberIsWhole(value: Record<string, unknown>) {
  const fractional = Object.entries(value)
    .filter(([, held]) => typeof held === 'number' && !Number.isInteger(held))
    .map(([field, held]) => `${field}=${String(held)}`);
  // Named rather than counted: the field is what says which end of the range
  // was left as a fraction.
  expect(fractional).toEqual([]);
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
    expect(control.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 65, text: '65%' });
    everyNumberIsWhole(control.props.accessibilityValue);
  });

  // The crash in #389: `musicVolume` defaults to 0.5, so the music slider took
  // a fraction into a field Fabric converts to `int` before the view exists.
  // It never reached layout, a gesture or a worklet — it died in createNode,
  // which is why the whole modal went with it.
  it('carries no fraction into a field the native side reads as a whole number', async () => {
    for (const value of [0.5, 0.42, 0.07, 1 / 3, 0.999]) {
      const view = await render(
        <Slider
          value={value}
          onValueChange={() => {}}
          a11yLabel="Music volume"
          valueText={`${Math.round(value * 100)}%`}
        />
      );
      everyNumberIsWhole(screen.getByLabelText('Music volume').props.accessibilityValue);
      await view.unmount();
    }
  });

  // The spoken value is the label, not the number, so scaling the range must
  // not change a word of what a screen reader says.
  it('still speaks the percentage it always did', async () => {
    await render(
      <Slider value={0.42} onValueChange={() => {}} a11yLabel="Music volume" valueText="42%" />
    );
    expect(screen.getByLabelText('Music volume').props.accessibilityValue.text).toBe('42%');
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
    expect(screen.getByLabelText('Sound effect volume').props.accessibilityValue.now).toBe(100);
    await increment();
    expect(screen.getByLabelText('Sound effect volume').props.accessibilityValue.now).toBe(100);
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
    expect(screen.getByLabelText('Music volume').props.accessibilityValue.now).toBe(42);
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
