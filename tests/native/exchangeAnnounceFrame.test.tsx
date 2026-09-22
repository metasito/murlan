// A view a Maestro flow waits for needs a frame of its own: iOS leaves a 0×0
// view out of the accessibility snapshot XCUITest hands Maestro, painted or not.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { ExchangeAnnouncement } from '@/components/ExchangeAnnouncement';
import type { Card } from '@/lib/gameEngine';
import type { ExchangeFlight } from '@/components/flightPhysics';

const TRIP: ExchangeFlight = {
  from: { dx: 0, dy: 120 },
  meet: { dx: 30, dy: 0 },
  to: { dx: 0, dy: -120 },
  lane: { dx: 30, dy: 0 },
  tag: { dx: 60, dy: -60 },
};
const CARD: Card = { id: '6_clubs', suit: 'clubs', rank: '6', isJoker: false };

const spans = (style: ViewStyle, size: 'width' | 'height', from: 'left' | 'top', to: 'right' | 'bottom') =>
  style[size] !== undefined ? style[size] !== 0 : style[from] !== undefined && style[to] !== undefined;

describe('ExchangeAnnouncement frame', () => {
  it.each([false, true])('exposes exchange-announce with a non-zero frame (bothJokers=%s)', async (bothJokers) => {
    const view = await render(
      <ExchangeAnnouncement
        visible
        winnerName="Ana"
        loserName="Bea"
        bothJokersException={bothJokers}
        cardReceived={CARD}
        cardGiven={CARD}
        toWinner={TRIP}
        toLoser={TRIP}
        landed
        scale={1}
        onDismiss={() => {}}
      />
    );
    await act(async () => {});
    const style = StyleSheet.flatten(view.getByTestId('exchange-announce').props.style) as ViewStyle;
    expect(spans(style, 'width', 'left', 'right')).toBe(true);
    expect(spans(style, 'height', 'top', 'bottom')).toBe(true);
    await view.unmount();
  });
});
