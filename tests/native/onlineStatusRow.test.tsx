// tests/native/onlineStatusRow.test.tsx — the online lobby's connection dot
// carries its state by colour alone (Colors.success vs Colors.textMuted);
// the text beside it (app/(online)/index.tsx `statusRow`) is the non-colour
// channel a colour-blind player reads instead. #130's promise is that the
// pairing survives, not just that the text node exists somewhere in the
// tree — see tests/native/visibilityHelpers.ts.
import { describe, it, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getVisibleText } from './visibilityHelpers';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, loading: false }),
}));

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({
    pendingInvite: null,
    clearInvite: jest.fn(),
    gameInvites: [],
    dismissGameInvite: jest.fn(),
    acceptedInvite: null,
    acceptInvite: jest.fn(),
    clearAcceptedInvite: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

const mockUseOnlineConnection = jest.fn();
jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({
    createRoom: jest.fn(),
    joinRoom: jest.fn(),
    spectateRoom: jest.fn(),
    room: null,
    isSpectator: false,
  }),
  useOnlineTable: () => ({ gameState: null }),
  useOnlineConnection: () => mockUseOnlineConnection(),
}));

import OnlineLobbyScreen from '@/app/(online)/index';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OnlineLobbyScreen />
    </SafeAreaProvider>
  );

describe('the online lobby connection status', () => {
  it('names the connected state next to the dot, actually visible — not colour alone', async () => {
    mockUseOnlineConnection.mockReturnValue({ connected: true, error: null, clearError: jest.fn() });
    const r = await mount();
    getVisibleText(screen, 'Connected as Ana');
    await r.unmount();
  });

  it('names the connecting state next to the dot, actually visible — not colour alone', async () => {
    mockUseOnlineConnection.mockReturnValue({ connected: false, error: null, clearError: jest.fn() });
    const r = await mount();
    getVisibleText(screen, 'Connecting…');
    await r.unmount();
  });
});
