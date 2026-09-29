// A view a Maestro flow waits for needs a frame of its own: iOS leaves a 0×0
// view out of the accessibility snapshot XCUITest hands Maestro, painted or not.
import { describe, it, expect, jest } from '@jest/globals';

import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { ExchangeLegs } from '@/components/table/ExchangeLegs';
import type { Card } from '@/lib/game/gameEngine';
import { restPoint, type LegPoints } from '@/lib/game/exchangeTimeline';
import { exchangeAnnounceMs } from '@/lib/exchangeCeremony';

const FAN = { x: 0, y: -120, rot: 0, scale: 0.4 };
const HAND = { x: 0, y: 120, rot: 0, scale: 1.2 };
const LEG: LegPoints = { from: FAN, fromFace: false, rest: restPoint(HAND), to: HAND, toFace: true };
const CARD: Card = { id: '6_clubs', suit: 'clubs', rank: '6', isJoker: false };

const spans = (style: ViewStyle, size: 'width' | 'height', from: 'left' | 'top', to: 'right' | 'bottom') =>
  style[size] !== undefined ? style[size] !== 0 : style[from] !== undefined && style[to] !== undefined;

describe('ExchangeLegs with no geometry measured', () => {
  it('still lands and dismisses, on its own frames', async () => {
    jest.useFakeTimers();
    const onLanded = jest.fn();
    const onDismiss = jest.fn();
    const ORIGIN = { x: 0, y: 0, rot: 0, scale: 1 };
    const view = await render(
      <ExchangeLegs
        data={{ winnerName: 'Ana', loserName: 'Bea', winnerIdx: 0, loserIdx: 1, bothJokersException: false, cardReceived: CARD, cardGiven: CARD }}
        legs={{ receive: { from: ORIGIN, fromFace: true, rest: ORIGIN, to: ORIGIN, toFace: true }, give: { from: ORIGIN, fromFace: true, rest: ORIGIN, to: ORIGIN, toFace: true } }}
        viewerSeat={0}
        scale={1}
        onLanded={onLanded}
        onDismiss={onDismiss}
      />
    );
    for (let t = 0; t < exchangeAnnounceMs(false) + 64; t += 16) await act(async () => jest.advanceTimersByTime(16));
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await view.unmount();
    jest.useRealTimers();
  });
});

describe('ExchangeLegs frame', () => {
  it.each([false, true])('exposes exchange-announce with a non-zero frame (bothJokers=%s)', async (bothJokers) => {
    const view = await render(
      <ExchangeLegs
        data={{ winnerName: 'Ana', loserName: 'Bea', winnerIdx: 0, loserIdx: 1, bothJokersException: bothJokers, cardReceived: CARD, cardGiven: CARD }}
        legs={{ receive: LEG, give: LEG }}
        viewerSeat={0}
        scale={1}
        onLanded={() => {}}
        onDismiss={() => {}}
      />
    );
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
