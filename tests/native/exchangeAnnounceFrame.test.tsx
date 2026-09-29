// A view a Maestro flow waits for needs a frame of its own: iOS leaves a 0×0
// view out of the accessibility snapshot XCUITest hands Maestro, painted or not.
import { describe, it, expect, jest } from '@jest/globals';

import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { LEG } from '@/lib/game/exchangeTimeline';
import { Motion } from '@/lib/tokens';
import { GEOMETRY, Legs, card, frames, trade } from './helpers/exchangeLegs';

const X = Motion.exchange;
const spans = (style: ViewStyle, size: 'width' | 'height', from: 'left' | 'top', to: 'right' | 'bottom') =>
  style[size] !== undefined ? style[size] !== 0 : style[from] !== undefined && style[to] !== undefined;

describe('ExchangeLegs with no geometry measured', () => {
  it('dismisses once, on the give landing and its read, on its own frames', async () => {
    jest.useFakeTimers();
    const onStage = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <Legs
        trade={trade({ cardGiven: card('6_clubs', '6') })}
        geometry={{ ...GEOMETRY, windowWidth: 0, windowHeight: 0, handCardH: 0 }}
        onStage={onStage}
        onDismiss={onDismiss}
      />
    );
    let landedAt = -1;
    await frames(X.beat + 2 * LEG.end + 2 * X.read + 64, (t) => {
      if (landedAt < 0 && onStage.mock.calls.some(([leg, s]) => leg === 'give' && s === 'landed')) landedAt = t;
      if (landedAt >= 0 && t < landedAt + X.read - 16) expect([t, onDismiss.mock.calls.length]).toEqual([t, 0]);
    });
    expect(landedAt).toBeGreaterThan(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await view.unmount();
    jest.useRealTimers();
  });
});

describe('ExchangeLegs frame', () => {
  it.each([false, true])('exposes exchange-announce with a non-zero frame (bothJokers=%s)', async (bothJokers) => {
    const view = await render(<Legs trade={trade({ bothJokersException: bothJokers })} />);
    await act(async () => {});
    const style = StyleSheet.flatten(view.getByTestId('exchange-announce').props.style) as ViewStyle;
    expect(spans(style, 'width', 'left', 'right')).toBe(true);
    expect(spans(style, 'height', 'top', 'bottom')).toBe(true);
    for (let node = view.getByRole('alert').parent; node; node = node.parent) {
      const own = StyleSheet.flatten(node.props.style ?? {}) as ViewStyle;
      expect(own.width === 0 || own.height === 0).toBe(false);
    }
    await view.unmount();
  });
});
