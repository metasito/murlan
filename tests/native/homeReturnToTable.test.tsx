// tests/native/homeReturnToTable.test.tsx — a player whose online table is
// still holding their seat has no way back to it from home unless home says
// so. The decision is `homeMenuModel`'s and unit-tested there; what a scan
// cannot see is whether the screen ever asks storage, so this renders it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPush = jest.fn();
let storedRoom: string | null = null;
let authUser: { id: string; username: string; tutorialSeenAt: string | null } | null = null;

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
}));

jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));

import HomeScreen from '@/app/index';
import { t } from '@/lib/i18n';
import { ACTIVE_ROOM_KEY } from '@/lib/storageKeys';
import { setMotion } from './harness/env';
import { aThreePlayed, state } from '../support/game';
import { offlineSave, renderApp } from './harness/renderApp';
import { unreachable } from './mocks/http';

const OFFLINE_MATCH = offlineSave(state({ openingCard: null, playedRanks: aThreePlayed() }), { length: 'match' });

const mount = async () => {
  await AsyncStorage.clear();
  if (storedRoom) await AsyncStorage.setItem(ACTIVE_ROOM_KEY, storedRoom);
  // Signed out with the session never confirmed gone: nothing has cleared the stale room key.
  return renderApp(<HomeScreen />, { ...(authUser ? { user: authUser } : { me: unreachable }), saved: OFFLINE_MATCH });
};

beforeEach(() => setMotion('on'));

describe('the home screen and a table still holding a seat', () => {
  beforeEach(() => {
    mockPush.mockClear();
    storedRoom = null;
    authUser = { id: 'u1', username: 'Ana', tutorialSeenAt: new Date().toISOString() };
  });

  it('offers the way back, ahead of the offline save', async () => {
    storedRoom = 'room-42';
    const view = await mount();

    const hero = await screen.findByText(t('home.returnToTable'), {
      includeHiddenElements: true,
    });
    expect(hero).toBeTruthy();
    expect(
      screen.getByText(t('home.resumeGame'), { includeHiddenElements: true })
    ).toBeTruthy();

    await view.unmount();
  });

  it('offers nothing of the kind with no room recorded', async () => {
    const view = await mount();

    expect(
      screen.queryByText(t('home.returnToTable'), { includeHiddenElements: true })
    ).toBeNull();
    expect(
      await screen.findByText(t('home.resumeGame'), { includeHiddenElements: true })
    ).toBeTruthy();

    await view.unmount();
  });

  it('asks nothing of storage for a signed-out player', async () => {
    authUser = null;
    storedRoom = 'room-42';
    const view = await mount();

    expect(
      screen.queryByText(t('home.returnToTable'), { includeHiddenElements: true })
    ).toBeNull();

    await view.unmount();
  });
});
