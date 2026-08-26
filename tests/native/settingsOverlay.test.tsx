// tests/native/settingsOverlay.test.tsx — the settings modal is the only real
// <Modal> in the normal flow, so it is where a scrollable body (UI-01) and a
// banner that can paint over it (UI-12) both have to be proved.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
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
// Hoisted above the factories below, which is why they carry the `mock` prefix
// jest requires for an out-of-scope reference.
const mockLogout = jest.fn<() => Promise<void>>();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  // The bug-report control sends the route it was opened from.
  usePathname: () => '/lobby',
}));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logout: mockLogout }) }));

import { SettingsModal } from '@/components/SettingsModal';
import {
  NotificationProvider,
  useNotification,
} from '@/context/NotificationContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { en as locale } from '@/locales/en';
import { Colors } from '@/lib/theme';

const METRICS = {
  frame: { x: 0, y: 0, width: 568, height: 320 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const apiRequest = (require('@/lib/query-client') as { apiRequest: jest.Mock }).apiRequest;

let notify: ReturnType<typeof useNotification>;

function Probe() {
  notify = useNotification();
  return null;
}

async function mount() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <SettingsProvider>
          <Probe />
          <SettingsModal visible onClose={() => {}} />
        </SettingsProvider>
      </NotificationProvider>
    </SafeAreaProvider>
  );
}

describe('settings modal', () => {
  it('puts the delete-account control inside a scroll view', async () => {
    const view = await mount();
    const body = screen.getByTestId('settings-scroll');
    expect(
      within(body).getByLabelText(locale['settings.deleteAccount'])
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
    expect(screen.getByLabelText(locale['settings.closeA11yLabel'])).toBeTruthy();
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

  // The control's own round trip: open, type, send, and both outcomes of
  // what apiRequest does with it. Everything the mock at the top of this
  // file exists for and nothing here used before.
  describe('reporting a bug', () => {
    beforeEach(() => {
      apiRequest.mockReset();
    });

    it('sends the reporter\'s own context and nothing about the table', async () => {
      apiRequest.mockImplementationOnce(() => Promise.resolve({ ok: true }));
      const view = await mount();

      await act(async () => {
        fireEvent.press(screen.getByLabelText(locale['settings.reportBug']));
      });
      await act(async () => {
        fireEvent.changeText(
          screen.getByLabelText(locale['settings.reportBugFieldA11yLabel']),
          'the cards went weird'
        );
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText(locale['settings.reportBugSend']));
      });

      // appVersion is read from Constants.expoConfig?.version, which the
      // jest-expo preset's own mock does not populate — undefined here, not
      // a value this test controls or should pin beyond that.
      expect(apiRequest).toHaveBeenCalledWith('POST', '/api/bug-reports', {
        description: 'the cards went weird',
        screen: '/lobby',
        appVersion: undefined,
        platform: Platform.OS,
        locale: 'en',
      });
      expect(
        screen.getByText(locale['settings.reportBugSentBody'], { includeHiddenElements: true })
      ).toBeTruthy();
      // The form closes on success — the toggle is back to its closed a11y state.
      expect(
        screen.queryByLabelText(locale['settings.reportBugFieldA11yLabel'])
      ).toBeNull();
      await view.unmount();
    });

    it('leaves the form open and the text intact when the send fails', async () => {
      apiRequest.mockImplementationOnce(() => Promise.reject(new Error('network')));
      const view = await mount();

      await act(async () => {
        fireEvent.press(screen.getByLabelText(locale['settings.reportBug']));
      });
      await act(async () => {
        fireEvent.changeText(
          screen.getByLabelText(locale['settings.reportBugFieldA11yLabel']),
          'stuck on the exchange screen'
        );
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText(locale['settings.reportBugSend']));
      });

      expect(
        screen.getByText(locale['settings.reportBugFailedBody'], { includeHiddenElements: true })
      ).toBeTruthy();
      // Not cleared: a player who lost their draft to a failed send has no
      // reason to trust send again.
      expect(
        screen.getByLabelText(locale['settings.reportBugFieldA11yLabel']).props.value
      ).toBe('stuck on the exchange screen');
      // And re-enabled, not left stuck on "Sending…" forever.
      expect(screen.getByLabelText(locale['settings.reportBugSend'])).toBeEnabled();
      await view.unmount();
    });

    it('refuses to send an empty report', async () => {
      const view = await mount();

      await act(async () => {
        fireEvent.press(screen.getByLabelText(locale['settings.reportBug']));
      });

      expect(screen.getByLabelText(locale['settings.reportBugSend'])).toBeDisabled();
      expect(apiRequest).not.toHaveBeenCalled();
      await view.unmount();
    });
  });

  // Leaving is one of two account controls that sit together, and the pair has
  // to stay told apart: one is reversible and the other is not.
  describe('logging out', () => {
    beforeEach(() => {
      mockLogout.mockReset();
      mockLogout.mockResolvedValue(undefined);
      mockReplace.mockReset();
    });

    async function pressLogout() {
      await act(async () => {
        fireEvent.press(screen.getByLabelText(locale['settings.logoutA11yLabel']));
      });
    }

    it('asks before it goes', async () => {
      const view = await mount();
      await pressLogout();

      expect(
        screen.getByText(locale['settings.logoutConfirmBody'], { includeHiddenElements: true })
      ).toBeTruthy();
      expect(mockLogout).not.toHaveBeenCalled();
      await view.unmount();
    });

    it('lands on the auth screen once confirmed', async () => {
      const view = await mount();
      await pressLogout();
      await act(async () => {
        fireEvent.press(screen.getByTestId('confirm-accept', { includeHiddenElements: true }));
      });

      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/auth');
      await view.unmount();
    });

    it('cancelling leaves the session alone', async () => {
      const view = await mount();
      await pressLogout();
      await act(async () => {
        fireEvent.press(screen.getByTestId('confirm-cancel', { includeHiddenElements: true }));
      });

      expect(mockLogout).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      await view.unmount();
    });

    // `logout` posts to the server before it clears anything locally, so a
    // failed post leaves the player signed in — and being told that is the
    // difference between a slow button and a dead one.
    it('says so when the server cannot be reached, and stays put', async () => {
      mockLogout.mockRejectedValueOnce(new Error('network'));
      const view = await mount();
      await pressLogout();
      await act(async () => {
        fireEvent.press(screen.getByTestId('confirm-accept', { includeHiddenElements: true }));
      });

      expect(
        screen.getByText(locale['settings.logoutFailedBody'], { includeHiddenElements: true })
      ).toBeTruthy();
      expect(mockReplace).not.toHaveBeenCalled();
      await view.unmount();
    });

    it('each account control is one node, and only one of them alarms', async () => {
      const view = await mount();

      for (const label of [
        locale['settings.logoutA11yLabel'],
        locale['settings.deleteAccount'],
      ]) {
        expect(screen.queryAllByLabelText(label, { includeHiddenElements: false })).toHaveLength(1);
      }
      // The visible words are hidden behind their own control's label, or a
      // screen reader announces each row twice.
      for (const word of [locale['settings.logout'], locale['settings.deleteAccount']]) {
        expect(screen.queryAllByText(word, { includeHiddenElements: false })).toHaveLength(0);
      }

      const colourOf = (label: string, word: string) => {
        const text = within(screen.getByLabelText(label)).getByText(word, {
          includeHiddenElements: true,
        });
        return (StyleSheet.flatten(text.props.style) as { color?: string }).color;
      };
      expect(colourOf(locale['settings.logoutA11yLabel'], locale['settings.logout'])).toBe(
        Colors.text
      );
      expect(
        colourOf(locale['settings.deleteAccount'], locale['settings.deleteAccount'])
      ).toBe(Colors.dangerDim);
      await view.unmount();
    });
  });
});
