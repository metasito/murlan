// tests/native/exchangeWatchdog.test.tsx — an exchange whose frame clock never advances still opens its choice and closes (#1624).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    useFrameCallback: (_step: unknown, autostart?: boolean) => actual.useFrameCallback(() => {}, autostart),
  };
});
jest.mock('@/lib/errorReporting', () => ({
  ...jest.requireActual<object>('@/lib/errorReporting'),
  __esModule: true,
  reportError: jest.fn(() => true),
}));

import { reportError } from '@/lib/errorReporting';
import { GATE_WATCHDOG_MS } from '@/lib/timeline/gateWatchdog';
import { Legs, announced, card } from './helpers/exchangeLegs';

const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));
const reported = () => jest.mocked(reportError).mock.calls.map(([e]) => (e as Error).message);

describe('an exchange whose frame clock never advances', () => {
  let was: typeof AppState.currentState;
  const subscribe = AppState.addEventListener;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(reportError).mockClear();
    was = AppState.currentState;
  });
  afterEach(() => {
    AppState.currentState = was;
    AppState.addEventListener = subscribe;
    jest.useRealTimers();
  });

  it('opens the choice once the watchdog has passed since go, then closes once it has passed since the choice', async () => {
    const onReady = jest.fn();
    const onDismiss = jest.fn();
    const legs = (over = {}) => <Legs announced={announced(over)} onReady={onReady} onDismiss={onDismiss} />;
    const view = await render(legs());
    await advance(GATE_WATCHDOG_MS - 100);
    expect({ ready: onReady.mock.calls.length, reported: reported() }).toEqual({ ready: 0, reported: [] });

    await advance(200);
    expect({ ready: onReady.mock.calls.length, reported: reported() }).toEqual({ ready: 1, reported: ['table gate forced: exchangeReady'] });

    await view.rerender(legs({ cardGiven: card('4_clubs', '4') }));
    await advance(GATE_WATCHDOG_MS - 100);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(200);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(reported()).toEqual(['table gate forced: exchangeReady', 'table gate forced: exchangeDone']);

    await advance(GATE_WATCHDOG_MS * 2);
    expect({ ready: onReady.mock.calls.length, dismissed: onDismiss.mock.calls.length }).toEqual({ ready: 1, dismissed: 1 });
    await view.unmount();
  });

  it('closes a both-Jokers exchange the watchdog after go, with no choice to open', async () => {
    const onReady = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <Legs announced={announced({ twoJokers: true, cardReceived: undefined })} onReady={onReady} onDismiss={onDismiss} />
    );
    await advance(GATE_WATCHDOG_MS - 100);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(200);
    expect({ ready: onReady.mock.calls.length, dismissed: onDismiss.mock.calls.length, reported: reported() }).toEqual({
      ready: 0,
      dismissed: 1,
      reported: ['table gate forced: exchangeDone'],
    });
    await view.unmount();
  });

  it('starts no watchdog before go, nor while the go was seen in the background', async () => {
    const onReady = jest.fn();
    const onDismiss = jest.fn();
    const legs = (go: boolean) => <Legs announced={announced({ cardGiven: card('4_clubs', '4') })} go={go} onReady={onReady} onDismiss={onDismiss} />;
    const view = await render(legs(false));
    await advance(GATE_WATCHDOG_MS * 3);
    AppState.currentState = 'background';
    await view.rerender(legs(true));
    await advance(GATE_WATCHDOG_MS * 3);
    expect({ ready: onReady.mock.calls.length, dismissed: onDismiss.mock.calls.length, reported: reported() }).toEqual({
      ready: 0,
      dismissed: 0,
      reported: [],
    });
    await view.unmount();
  });

  it('counts no hidden time: a watchdog running when the page hides waits a full span once it is back', async () => {
    const listeners = new Set<(state: AppStateStatus) => void>();
    AppState.addEventListener = (_type, handler) => {
      listeners.add(handler);
      return { remove: () => listeners.delete(handler) };
    };
    const pageGoes = (state: AppStateStatus) =>
      act(async () => {
        AppState.currentState = state;
        listeners.forEach((h) => h(state));
      });
    const onReady = jest.fn();
    const view = await render(<Legs announced={announced()} onReady={onReady} />);
    await advance(GATE_WATCHDOG_MS / 2);
    await pageGoes('background');
    await advance(GATE_WATCHDOG_MS * 3);
    expect({ ready: onReady.mock.calls.length, reported: reported() }).toEqual({ ready: 0, reported: [] });

    await pageGoes('active');
    await advance(GATE_WATCHDOG_MS - 100);
    expect({ ready: onReady.mock.calls.length, reported: reported() }).toEqual({ ready: 0, reported: [] });
    await advance(200);
    expect({ ready: onReady.mock.calls.length, reported: reported() }).toEqual({ ready: 1, reported: ['table gate forced: exchangeReady'] });
    await view.unmount();
  });

  it('times done from the choice opening when the choice came first, and a forced done keeps an e2e hold', async () => {
    const onDismiss = jest.fn();
    const view = await render(<Legs announced={announced({ cardGiven: card('4_clubs', '4') })} onDismiss={onDismiss} holdMsOverride={GATE_WATCHDOG_MS * 5} />);
    await advance(GATE_WATCHDOG_MS + 100);
    expect(reported()).toEqual(['table gate forced: exchangeReady']);
    await advance(GATE_WATCHDOG_MS - 200);
    expect(reported()).toEqual(['table gate forced: exchangeReady']);
    await advance(300);
    expect({ dismissed: onDismiss.mock.calls.length, reported: reported() }).toEqual({
      dismissed: 0,
      reported: ['table gate forced: exchangeReady', 'table gate forced: exchangeDone'],
    });
    await view.unmount();
  });
});
