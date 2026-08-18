// tests/native/settingsOverlay.test.tsx — the settings modal is the only real
// <Modal> in the normal flow, and at phone-landscape heights its body does not
// fit the backdrop.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/query-client', () => ({
  apiRequest: jest.fn(),
  queryClient: { clear: () => {} },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));
jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logout: jest.fn() }) }));

import { SettingsModal } from '@/components/SettingsModal';
import { NotificationProvider } from '@/context/NotificationContext';
import { it as itLocale } from '@/locales/it';

const METRICS = {
  frame: { x: 0, y: 0, width: 568, height: 320 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function mount() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <SettingsModal visible onClose={() => {}} />
      </NotificationProvider>
    </SafeAreaProvider>
  );
}

describe('settings modal', () => {
  it('puts the delete-account control inside a scroll view', async () => {
    const view = await mount();
    const body = screen.getByTestId('settings-scroll');
    expect(
      within(body).getByLabelText(itLocale['settings.deleteAccount'])
    ).toBeTruthy();
    await view.unmount();
  });
});
