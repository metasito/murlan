// tests/native/replayScrubSilent.test.tsx — a replay sounds a closing pass it steps onto, and not one it jumps to.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'r1' }),
}));

const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });

/** Ana leads, Besi's pass closes the trick, Ana leads again. */
const REPLAY = {
  id: 'r1',
  finishedAt: '2026-10-16T10:00:00.000Z',
  gameMode: 'free_for_all',
  seats: [
    { seatIndex: 0, userId: 'u1', name: 'Ana' },
    { seatIndex: 1, userId: 'u2', name: 'Besi' },
  ],
  finishingOrder: [],
  moves: [
    { seat: 0, combo: { type: 'single', cards: [card('K', 'hearts')], strength: 13 }, handCounts: [2, 3] },
    { seat: 1, combo: null, handCounts: [2, 3] },
    { seat: 0, combo: { type: 'single', cards: [card('Q', 'hearts')], strength: 12 }, handCounts: [1, 3] },
  ],
};

import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey } from '@/shared/i18n';
import { queriesSettled, renderApp } from './harness/renderApp';
import { route } from './mocks/http';
import { bootFeedback, startsOf } from './helpers/feedback';

const ReplayScreen = require('@/app/(online)/replay').default as React.ComponentType;

const t = (key: string) => translate(DEFAULT_LOCALE, key as TranslationKey);
const METRICS = { frame: { x: 0, y: 0, width: 800, height: 400 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
/** Past a landing's pile-up window, which would mask the sting either way. */
const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(4000);
  });

const show = async () => {
  route('GET', '/api/replays/r1', { body: REPLAY });
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ReplayScreen />
    </SafeAreaProvider>,
    { user: { id: 'u1', username: 'Ana' } }
  );
  await queriesSettled();
  jest.useFakeTimers();
  return view;
};

describe('a replay reaching the pass that closed a trick', () => {
  beforeEach(async () => {
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sounds the trick won when it steps onto it', async () => {
    const view = await show();
    await fireEvent.press(view.getByLabelText(t('replay.nextA11yLabel')));
    await settle();
    await fireEvent.press(view.getByLabelText(t('replay.nextA11yLabel')));
    await settle();
    expect(startsOf('trick_win')).toHaveLength(1);
    await view.unmount();
  });

  it('stays silent when it jumps there from the move list', async () => {
    const view = await show();
    await fireEvent.press(view.getByLabelText(t('replay.movesToggleA11yLabel')));
    await fireEvent.press(view.getByLabelText(/^Move 2:/));
    await settle();
    expect(startsOf('trick_win')).toHaveLength(0);
    expect(startsOf('pass')).toHaveLength(0);
    await view.unmount();
  });
});
