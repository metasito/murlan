// tests/native/replayEndStopsPlayback.test.tsx — the transport at the end of
// the tape. Playback used to stop itself from an effect on `atEnd`, so a play
// tapped once the last move was showing turned the key to pause over a tape
// that never moved again. Whether the replay is playing is now answered in
// render, and this is the answer nothing else asks for.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'r1' }),
}));

const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const combo = (type: string, cards: ReturnType<typeof card>[]) => ({ type, cards, strength: 1 });

const REPLAY = {
  id: 'r1',
  finishedAt: '2026-08-20T10:00:00.000Z',
  gameMode: 'free_for_all',
  seats: [
    { seatIndex: 0, userId: 'u1', name: 'Ana' },
    { seatIndex: 1, userId: 'u2', name: 'Besi' },
  ],
  finishingOrder: [],
  moves: [
    { seat: 0, combo: combo('single', [card('3', 'spades')]), handCounts: [2, 3] },
    { seat: 1, combo: null, handCounts: [2, 3] },
  ],
};

import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey } from '@/shared/i18n';
import { queriesSettled, renderApp } from './harness/renderApp';
import { route } from './mocks/http';

const ReplayScreen = require('@/app/(online)/replay').default as React.ComponentType;

const t = (key: string) => translate(DEFAULT_LOCALE, key as TranslationKey);

const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 400 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const show = async (answer?: Parameters<typeof route>[2]) => {
  if (answer) route('GET', '/api/replays/r1', answer);
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ReplayScreen />
    </SafeAreaProvider>,
    { user: { id: 'u1', username: 'Ana' } }
  );
  await queriesSettled();
  return view;
};

describe('the replay transport once the tape has run out', () => {
  it('answers play, not pause, to a play tapped on the last move', async () => {
    const view = await show({ body: REPLAY });
    // Two moves, so stepping twice lands on the last one.
    await fireEvent.press(view.getByLabelText(t('replay.nextA11yLabel')));
    await fireEvent.press(view.getByLabelText(t('replay.nextA11yLabel')));

    await fireEvent.press(view.getByLabelText(t('replay.playA11yLabel')));

    expect(view.queryByLabelText(t('replay.pauseA11yLabel'))).toBeNull();
    expect(view.queryByLabelText(t('replay.playA11yLabel'))).not.toBeNull();
    await view.unmount();
  });
});
