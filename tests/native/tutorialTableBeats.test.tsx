// tests/native/tutorialTableBeats.test.tsx — the Pass, turn-clock and staging beats.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

import TutorialScreen from '@/app/tutorial';
import { t } from '@/lib/i18n';
import { TUTORIAL_PROGRESS_KEY } from '@/lib/storageKeys';
import { setMotion } from './harness/env';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function openAt(beatId: string, title: string) {
  await AsyncStorage.setItem(TUTORIAL_PROGRESS_KEY, beatId);
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TutorialScreen />
    </SafeAreaProvider>
  );
  await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
  return r;
}

async function press(el: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    await fireEvent.press(el);
  });
}

const HIDDEN = { includeHiddenElements: true };

beforeEach(() => setMotion('on'));

describe('tutorial beats on the table the player will meet', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('answers an unbeatable single with Pass', async () => {
    const r = await openAt('pass', t('tutorial.beat.pass.title'));
    expect(screen.queryByText(t('tutorial.beat.pass.successNarrative'))).toBeNull();

    await press(screen.getByLabelText(t('tutorial.pass')));

    expect(screen.getByText(t('tutorial.beat.pass.successNarrative'))).toBeTruthy();
    expect(screen.queryByLabelText(t('tutorial.pass'))).toBeNull();
    await r.unmount();
  });

  it('runs the turn clock under the text', async () => {
    const r = await openAt('clock', t('tutorial.beat.clock.title'));
    expect(screen.getByTestId('turn-chip-dot', { includeHiddenElements: true })).toBeTruthy();
    await r.unmount();
  });

  it('says whether a staged selection would go before it is played', async () => {
    const r = await openAt('stage', t('tutorial.beat.stage.title'));
    expect(screen.queryByTestId('tutorial-staged', HIDDEN)).toBeNull();

    await press(screen.getByTestId('tutorial-card-6_hearts'));
    await press(screen.getByTestId('tutorial-card-6_clubs'));
    expect(screen.getByTestId('tutorial-staged', HIDDEN)).toHaveTextContent(/^Not yet: /);
    expect(await screen.findByLabelText(/^Not yet: /)).toBeTruthy();
    expect(screen.queryByTestId('tutorial-staged')).toBeNull();

    await press(screen.getByTestId('tutorial-card-6_hearts'));
    await press(screen.getByTestId('tutorial-card-6_clubs'));
    await press(screen.getByTestId('tutorial-card-9_diamonds'));
    await press(screen.getByTestId('tutorial-card-9_spades'));
    expect(screen.getByTestId('tutorial-staged', HIDDEN)).toHaveTextContent(t('tutorial.stagedReady'));
    expect(await screen.findByLabelText(t('tutorial.stagedReady'))).toBeTruthy();

    await press(screen.getByLabelText(t('tutorial.playCombination')));
    expect(screen.getAllByText(t('tutorial.beat.stage.successNarrative'), HIDDEN)).toBeTruthy();
    expect(await screen.findByLabelText(t('tutorial.beat.stage.successNarrative'))).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await r.unmount();
  });

  it('announces a wrong play as an alert', async () => {
    const r = await openAt('pass', t('tutorial.beat.pass.title'));

    await press(screen.getByTestId('tutorial-card-4_diamonds'));
    await press(screen.getByLabelText(t('tutorial.playCombination')));

    const alert = await screen.findByRole('alert');
    expect(String(alert.props.accessibilityLabel)).not.toBe('');
    await r.unmount();
  });
});
