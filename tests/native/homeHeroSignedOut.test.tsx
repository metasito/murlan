// tests/native/homeHeroSignedOut.test.tsx — signed out with nothing saved, the hero has to say
// on its face that it leads to signing in (#394). `homeMenuModel` decides that it needs an account;
// what only a render can see is that decision reaching the hero's accessible name.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
}));

jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));

import HomeScreen from '@/app/index';
import { t } from '@/lib/i18n';
import { setMotion } from './harness/env';
import { renderApp } from './harness/renderApp';

describe('the signed-out home screen with nothing saved', () => {
  it('names one hero, the online one, and says it leads to signing in', async () => {
    setMotion('on');
    const view = await renderApp(<HomeScreen />);

    const heroes = await screen.findAllByTestId('home-hero', { includeHiddenElements: true });
    expect(heroes).toHaveLength(1);
    const name = String(heroes[0].props.accessibilityLabel);
    expect(name).toContain(t('home.playOnline'));
    expect(name).toContain(t('home.playOnlineSignedOut'));
    expect(screen.queryByText(t('home.resumeGame'), { includeHiddenElements: true })).toBeNull();

    await view.unmount();
  });
});
