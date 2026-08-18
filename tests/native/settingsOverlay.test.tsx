// tests/native/settingsOverlay.test.tsx — the settings modal is the only real
// <Modal> in the normal flow, so it is where a scrollable body (UI-01) and a
// banner that can paint over it (UI-12) both have to be proved.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
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
import {
  NotificationProvider,
  useNotification,
} from '@/context/NotificationContext';
import { it as itLocale } from '@/locales/it';

const METRICS = {
  frame: { x: 0, y: 0, width: 568, height: 320 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

let notify: ReturnType<typeof useNotification>;

function Probe() {
  notify = useNotification();
  return null;
}

async function mount() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <Probe />
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

  it('shows a notification over the modal and stays open', async () => {
    const view = await mount();
    await act(async () => {
      notify.showNotification({
        type: 'game_invite',
        title: 'Invito',
        message: 'Tocca per unirti',
      });
    });
    // The banner starts at opacity 0 and animates in, which is what hides it
    // from the default accessibility-aware query.
    expect(
      screen.getByText('Tocca per unirti', { includeHiddenElements: true })
    ).toBeTruthy();
    expect(screen.getByLabelText(itLocale['settings.closeA11yLabel'])).toBeTruthy();
    await view.unmount();
  });

  // Two banners read one queue; a dismissal from either must drop one entry.
  it('drops a notification once when both banners dismiss it', async () => {
    const view = await mount();
    await act(async () => {
      notify.showNotification({ type: 'game_info', title: 'A', message: 'primo' });
      notify.showNotification({ type: 'game_info', title: 'B', message: 'secondo' });
    });
    await act(async () => {
      notify.dismissNotification();
      notify.dismissNotification();
    });
    expect(notify.notification?.message).toBe('secondo');
    await view.unmount();
  });
});
