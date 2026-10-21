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

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

import OnlineLobbyScreen from '@/app/(online)/index';


/** `id` apart per test: an account's socket outlives the render, connected or not. */
const mount = async (id: string, connected: boolean) => {
  await setWindow({ width: 390, height: 844 });
  return renderApp(<OnlineLobbyScreen />, { user: { id, username: 'Ana' }, online: true, connected });
};

describe('the online lobby connection status', () => {
  it('names the connected state next to the dot, actually visible — not colour alone', async () => {
    const r = await mount('u1', true);
    getVisibleText(screen, 'Connected as Ana');
    await r.unmount();
  });

  it('names the connecting state next to the dot, actually visible — not colour alone', async () => {
    const r = await mount('u2', false);
    getVisibleText(screen, 'Connecting…');
    await r.unmount();
  });
});
