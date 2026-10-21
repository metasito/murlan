// tests/native/protocolMismatch.test.tsx — a payload this bundle cannot read
// blocks the app behind a reload instead of crashing it, and forgets the room a
// cold start would otherwise rejoin straight back into the same state.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { screen, waitFor } from '@testing-library/react-native';

const mockReportError = jest.fn(() => true);
jest.mock('@/lib/errorReporting', () => ({
  ...jest.requireActual<object>('@/lib/errorReporting'),
  reportError: (...args: unknown[]) => mockReportError(...(args as [])),
}));

import { UpdateRequired } from '@/components/UpdateRequired';
import { ACTIVE_ROOM_KEY } from '@/lib/storageKeys';
import { t } from '@/lib/i18n';
import { renderApp } from './harness/renderApp';

async function mount() {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, 'R1');
  const view = await renderApp(<UpdateRequired />, { user: { id: 'u1', username: 'Ana' }, online: true, connected: true });
  await waitFor(() => expect(view.socket().sentAs('game:rejoin')).not.toEqual([]));
  return view;
}

describe('a game:state this bundle cannot read', () => {
  beforeEach(async () => {
    mockReportError.mockClear();
    await AsyncStorage.clear();
  });

  it('shows the update state, forgets the room and reports it, without throwing', async () => {
    const view = await mount();
    expect(screen.queryByText(t('updateRequired.title'))).toBeNull();

    const ack = jest.fn();
    await view.socket().deliver('game:state', { currentTurnIndex: 0, roundOver: false, finishingOrder: [] } as never, ack);

    await waitFor(() => expect(screen.getByText(t('updateRequired.title'))).toBeTruthy());
    await waitFor(async () => expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBeNull());
    expect(mockReportError).toHaveBeenCalled();
    await view.unmount();
  });
});
