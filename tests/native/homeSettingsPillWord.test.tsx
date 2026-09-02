// tests/native/homeSettingsPillWord.test.tsx — every landscape pill names
// itself.
//
// A source scan cannot see this: `text` is an optional prop, so a pill that
// stops passing one still compiles, still renders, and still carries the right
// accessibility label. Only the rendered tree says whether the word is drawn,
// which is why each assertion reaches inside the pill's own node rather than
// searching the screen.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));

let mockAuthUser: { id: string; username: string; tutorialSeenAt: string | null } | null = null;
let mockLandscape = true;

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuthUser, loading: false }),
}));
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({ hasSavedGame: false, resumeGame: () => false }),
}));
jest.mock('@/context/SocketContext', () => ({ useSocket: () => ({ gameInvites: [] }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(async () => ({ json: async () => ({}) })),
}));
jest.mock('@/lib/orientation', () => ({
  ...jest.requireActual<object>('@/lib/orientation'),
  useIsLandscape: () => mockLandscape,
}));
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import HomeScreen from '@/app/index';
import { t } from '@/lib/i18n';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 47, bottom: 21 },
};

const mount = () => render(<SafeAreaProvider initialMetrics={METRICS}><HomeScreen /></SafeAreaProvider>);

// The word is drawn inside `a11yHidden()`, and RNTL skips a hidden subtree by
// default — without this every query below is answered by the veil rather than
// by the pill, and reads the same whether the word is there or not.
const HIDDEN = { includeHiddenElements: true } as const;

describe('the landscape Settings pill', () => {
  beforeEach(() => {
    mockLandscape = true;
    mockAuthUser = null;
  });

  it('carries the Settings word when nobody is signed in', async () => {
    const r = await mount();

    const pill = screen.getByTestId('home-account-settings');
    expect(within(pill).getByText(t('home.settingsA11yLabel'), HIDDEN)).toBeTruthy();

    await r.unmount();
  });

  it('carries it when someone is', async () => {
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: new Date().toISOString() };
    const r = await mount();

    const pill = screen.getByTestId('home-account-settings');
    expect(within(pill).getByText(t('home.settingsA11yLabel'), HIDDEN)).toBeTruthy();

    await r.unmount();
  });

  // The word is the same string the pill is already named by, so it must stay
  // hidden from assistive technology: two nodes reading "Settings" is the
  // defect `tests/a11yOneNode.test.ts` exists to refuse.
  it('leaves the pill a single node named Settings', async () => {
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };
    const r = await mount();

    const pill = screen.getByTestId('home-account-settings');
    expect(pill.props.accessibilityLabel).toBe(t('home.settingsA11yLabel'));
    const word = within(pill).getByText(t('home.settingsA11yLabel'), HIDDEN);
    expect(word.props.accessibilityElementsHidden).toBe(true);
    expect(word.props.importantForAccessibility).toBe('no-hide-descendants');

    await r.unmount();
  });

  // Portrait's account bar is icon-only for every entry, and #826 does not
  // touch it — a word there would be the only one in a uniform row.
  it('is not what portrait draws', async () => {
    mockLandscape = false;
    mockAuthUser = { id: 'u1', username: 'Ana', tutorialSeenAt: null };
    const r = await mount();

    expect(screen.queryByTestId('home-account-settings')).toBeNull();
    expect(screen.queryByText(t('home.settingsA11yLabel'), HIDDEN)).toBeNull();

    await r.unmount();
  });
});
