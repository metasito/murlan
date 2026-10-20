// tests/native/homeHeroSignedOut.test.tsx — signed out with nothing saved, the hero has to say
// on its face that it leads to signing in (#394). `homeMenuModel` decides that it needs an account;
// what only a render can see is that decision reaching the hero's accessible name.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}),
  },
}));

jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
jest.mock('@/context/GameContext', () =>
  (require('./helpers/localContextMock') as typeof import('./helpers/localContextMock')).localContextMock(undefined, () => ({
    hasSavedGame: false,
    resumeGame: () => false,
  }))
);
jest.mock('@/context/SocketContext', () => ({ useInvites: () => ({ invites: [], accept: () => {} }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(async () => ({ json: async () => ({}) })),
}));
import HomeScreen from '@/app/index';
import { t } from '@/lib/i18n';
import { setMotion } from './harness/env';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

describe('the signed-out home screen with nothing saved', () => {
  it('names one hero, the online one, and says it leads to signing in', async () => {
    setMotion('on');
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <HomeScreen />
      </SafeAreaProvider>
    );

    const heroes = await screen.findAllByTestId('home-hero', { includeHiddenElements: true });
    expect(heroes).toHaveLength(1);
    const name = String(heroes[0].props.accessibilityLabel);
    expect(name).toContain(t('home.playOnline'));
    expect(name).toContain(t('home.playOnlineSignedOut'));
    expect(screen.queryByText(t('home.resumeGame'), { includeHiddenElements: true })).toBeNull();

    await view.unmount();
  });
});
