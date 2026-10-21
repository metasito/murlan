// tests/native/settingsOverlay.test.tsx — the settings modal is the only real
// <Modal> in the normal flow, so it is where a scrollable body (UI-01) and a
// banner that can paint over it (UI-12) both have to be proved.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Platform, StyleSheet, Text } from 'react-native';

// Hoisted above the factory below, which is why it carries the `mock` prefix
// jest requires for an out-of-scope reference.
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  // The bug-report control sends the route it was opened from.
  usePathname: () => '/lobby',
}));

import { SettingsModal } from '@/components/SettingsModal';
import { useBanner, useNotification } from '@/context/NotificationContext';
import { useScreenShakeEnabled } from '@/lib/screenShake';
import { en as locale } from '@/locales/en';
import { Colors } from '@/lib/theme';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { httpRequests, route, unreachable } from './mocks/http';

const sentTo = (method: string, path: string) =>
  httpRequests().filter((r) => r.method === method && r.path === path);
const bugReports = () => sentTo('POST', '/api/bug-reports').map((r) => r.body);
const logouts = () => sentTo('POST', '/api/auth/logout').length;

let notify: ReturnType<typeof useNotification> & ReturnType<typeof useBanner>;

function Probe() {
  notify = { ...useNotification(), ...useBanner() };
  return <Text>{`shake:${useScreenShakeEnabled()}`}</Text>;
}

async function mount() {
  await setWindow({ width: 568, height: 320 });
  return renderApp(
    <>
      <Probe />
      <SettingsModal visible onClose={() => {}} />
    </>,
    { user: { id: 'u1', username: 'Ana' } }
  );
}

describe('settings modal', () => {
  it('its screen-shake switch turns the table shake off', async () => {
    const view = await mount();
    expect(screen.getByText('shake:true')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(locale['settings.screenShakeA11yLabel']));
    expect(screen.getByText('shake:false')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(locale['settings.screenShakeA11yLabel']));
    await view.unmount();
  });

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
  // what the server does with it.
  describe('reporting a bug', () => {
    it('sends the reporter\'s own context and nothing about the table', async () => {
      route('POST', '/api/bug-reports', { body: { ok: true } });
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
      expect(bugReports()).toEqual([
        {
          description: 'the cards went weird',
          screen: '/lobby',
          appVersion: undefined,
          platform: Platform.OS,
          locale: 'en',
        },
      ]);
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
      route('POST', '/api/bug-reports', unreachable);
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
      expect(bugReports()).toEqual([]);
      await view.unmount();
    });
  });

  // Leaving is one of two account controls that sit together, and the pair has
  // to stay told apart: one is reversible and the other is not.
  describe('logging out', () => {
    beforeEach(() => {
      route('POST', '/api/auth/logout', { body: { ok: true } });
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
      expect(logouts()).toBe(0);
      await view.unmount();
    });

    it('lands on the auth screen once confirmed', async () => {
      const view = await mount();
      await pressLogout();
      await act(async () => {
        fireEvent.press(screen.getByTestId('confirm-accept', { includeHiddenElements: true }));
      });

      expect(logouts()).toBe(1);
      expect(mockReplace).toHaveBeenCalledWith('/auth');
      await view.unmount();
    });

    it('cancelling leaves the session alone', async () => {
      const view = await mount();
      await pressLogout();
      await act(async () => {
        fireEvent.press(screen.getByTestId('confirm-cancel', { includeHiddenElements: true }));
      });

      expect(logouts()).toBe(0);
      expect(mockReplace).not.toHaveBeenCalled();
      await view.unmount();
    });

    // `logout` posts to the server before it clears anything locally, so a
    // failed post leaves the player signed in — and being told that is the
    // difference between a slow button and a dead one.
    it('says so when the server cannot be reached, and stays put', async () => {
      route('POST', '/api/auth/logout', unreachable);
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
