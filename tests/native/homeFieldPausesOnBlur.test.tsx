import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { screen } from '@testing-library/react-native';

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
import HomeScreen from '@/app/index';
import { renderApp } from './harness/renderApp';

const loopsOnMount = async (focused: boolean) => {
  mockFocus.focused = focused;
  mockLoops.n = 0;
  const r = await renderApp(<HomeScreen />);
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
