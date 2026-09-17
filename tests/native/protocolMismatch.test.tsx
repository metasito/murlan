// tests/native/protocolMismatch.test.tsx — a payload this bundle cannot read
// blocks the app behind a reload instead of crashing it, and forgets the room a
// cold start would otherwise rejoin straight back into the same state.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Listener>>();
const emitted: string[] = [];

const mockSocket = {
  connected: true,
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  },
  off() {},
  emit(event: string) {
    emitted.push(event);
  },
};

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

const mockReportError = jest.fn(() => true);
jest.mock('@/lib/errorReporting', () => ({
  reportError: (...args: unknown[]) => mockReportError(...(args as [])),
}));

import { OnlineGameProvider } from '@/context/OnlineGameContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { UpdateRequired } from '@/components/UpdateRequired';
import { ACTIVE_ROOM_KEY } from '@/lib/storageKeys';
import { t } from '@/lib/i18n';

const deliver = async (event: string, ...args: unknown[]) => {
  await act(async () => {
    listeners.get(event)?.forEach((fn) => fn(...args));
  });
};

async function mount() {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, 'R1');
  const client = new QueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <NotificationProvider>
        <OnlineGameProvider userId="u1">
          <UpdateRequired />
        </OnlineGameProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
  await waitFor(() => expect(emitted).toContain('game:rejoin'));
  return view;
}

describe('a game:state this bundle cannot read', () => {
  beforeEach(async () => {
    listeners.clear();
    emitted.length = 0;
    mockReportError.mockClear();
    await AsyncStorage.clear();
  });

  it('shows the update state, forgets the room and reports it, without throwing', async () => {
    const view = await mount();
    expect(screen.queryByText(t('updateRequired.title'))).toBeNull();

    const ack = jest.fn();
    await deliver('game:state', { currentTurnIndex: 0, gameOver: false, rankings: [] }, ack);

    await waitFor(() => expect(screen.getByText(t('updateRequired.title'))).toBeTruthy());
    await waitFor(async () => expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBeNull());
    expect(mockReportError).toHaveBeenCalled();
    await view.unmount();
  });
});
