import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockFocus = { focused: true };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useIsFocused: () => mockFocus.focused,
}));

const mockLoops = { n: 0 };
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    withRepeat: (...args: Parameters<typeof actual.withRepeat>) => {
      mockLoops.n += 1;
      return actual.withRepeat(...args);
    },
  };
});

jest.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({ hasSavedGame: false, resumeGame: () => false }),
}));
jest.mock('@/context/SocketContext', () => ({ useSocket: () => ({ gameInvites: [] }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(async () => ({ json: async () => ({}) })),
}));
jest.mock('@/lib/accessibility', () => ({
  ...jest.requireActual<object>('@/lib/accessibility'),
  usePrefersReducedMotion: () => false,
}));

import HomeScreen from '@/app/index';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 47, bottom: 21 },
};

const loopsOnMount = async (focused: boolean) => {
  mockFocus.focused = focused;
  mockLoops.n = 0;
  const r = await render(<SafeAreaProvider initialMetrics={METRICS}><HomeScreen /></SafeAreaProvider>);
  const cards = screen.getAllByTestId('floating-card', { includeHiddenElements: true }).length;
  const loops = mockLoops.n;
  await r.unmount();
  return { cards, loops };
};

describe('the home card field', () => {
  it('drifts nothing while another screen covers home', async () => {
    const shown = await loopsOnMount(true);
    const covered = await loopsOnMount(false);
    expect(shown.cards).toBeGreaterThan(0);
    expect(shown.loops - covered.loops).toBe(2 * shown.cards);
  });
});
