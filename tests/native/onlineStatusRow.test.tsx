// tests/native/onlineStatusRow.test.tsx — the online lobby's connection dot
// carries its state by colour alone (Colors.success vs Colors.textMuted);
// the text beside it (components/ConnectionStatus.tsx) is the non-colour
// channel a colour-blind player reads instead. #130's promise is that the
// pairing survives, not just that the text node exists somewhere in the
// tree — see tests/native/visibilityHelpers.ts.
import { describe, it, jest } from '@jest/globals';
import React from 'react';
import { screen } from '@testing-library/react-native';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';

import { getVisibleText } from './visibilityHelpers';

jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  useInvites: () => ({
    prompt: null,
    clearPrompt: jest.fn(),
    invites: [],
    dismiss: jest.fn(),
    accepted: null,
    accept: jest.fn(),
    clearAccepted: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

const mockUseOnlineConnection = jest.fn();
jest.mock('@/context/onlineGameHooks', () => ({
  useServerError: () => null,
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


const mount = async () => {
  await setWindow({ width: 390, height: 844 });
  return renderApp(<OnlineLobbyScreen />, { user: { id: 'u1', username: 'Ana' } });
};

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
