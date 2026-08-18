// tests/native/connectingState.test.tsx — what the online game screen shows
// before any state has arrived.
//
// Four `room:spectate` refusals, and every rejoin failure, put the player on
// this screen with nothing to draw. It must still render: the error toast that
// explains why is further down the same tree, and a screen with no text and no
// control leaves the browser's back button as the only way out.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { it as itLocale } from '@/locales/it';

const mockReplace = jest.fn();
const mockLeaveRoom = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: mockReplace, push: jest.fn(), back: jest.fn() },
}));

// Pulled in by <GameTable> through lib/sounds; the native module has no JS
// implementation to load here, and nothing in this test makes a sound.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' } }),
}));

jest.mock('@/context/OnlineGameContext', () => ({
  useOnlineGame: () => ({
    // A spectate the server refused: no state, and no rejoin failure to bounce
    // off the screen either.
    gameState: null,
    reactions: [],
    mySeatIndex: -1,
    isSpectator: true,
    playerLeft: false,
    rejoinFailed: false,
    reconnectNotice: null,
    connected: true,
    error: null,
    clearError: jest.fn(),
    playCards: jest.fn(),
    pass: jest.fn(),
    giveExchangeCard: jest.fn(),
    sendReaction: jest.fn(),
    leaveRoom: mockLeaveRoom,
    voteRematch: jest.fn(),
    entrySource: null,
    rematchVoteState: null,
    cumulativeScores: {},
    matchState: { target: 21, length: 'match', over: false, winners: [], isDraw: false, continues: false },
    rematchIntents: { yes: 0, total: 0, answers: {} },
    rematchPromptOpen: false,
    answerRematch: jest.fn(),
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    acknowledgeExchange: jest.fn(),
    clearPlayerLeft: jest.fn(),
    clearRejoinFailed: jest.fn(),
  }),
}));

// Required, not imported: an import is hoisted above the mock functions the
// factories above close over, and expo-router's would capture an undefined one.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType })
  .default;

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const BACK_LABEL = itLocale['onlineGame.backToLobby'];

describe('the online table with no state yet', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockLeaveRoom.mockClear();
  });

  it('says what it is waiting for', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );

    expect(view.getByText(itLocale['onlineGame.connecting'])).toBeTruthy();

    await view.unmount();
  });

  it('offers a back control a screen reader can reach', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );

    const back = view.getByRole('button', { name: BACK_LABEL });
    expect(back).toBeTruthy();

    await view.unmount();
  });

  it('releases the table and returns to the lobby when it is pressed', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );

    fireEvent.press(view.getByRole('button', { name: BACK_LABEL }));

    await waitFor(() => expect(mockLeaveRoom).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('/(online)');

    await view.unmount();
  });
});
