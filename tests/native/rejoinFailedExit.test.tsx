// tests/native/rejoinFailedExit.test.tsx — how the online game screen leaves a
// table the server refused to let the player back into.
//
// It must navigate without emitting `room:leave`: mid-game that reaches
// handleLeaveRoom and vacates the seat on the spot, ahead of the 60s
// disconnect grace that owns it. A refused rejoin is not the player leaving.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockLeaveRoom = jest.fn();
const mockClearRejoinFailed = jest.fn();

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
    // A failed rejoin has already cleared the state, so the screen renders
    // nothing — every hook still runs, which is what this test drives.
    gameState: null,
    reactions: [],
    mySeatIndex: -1,
    isSpectator: false,
    playerLeft: false,
    rejoinFailed: true,
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
    clearRejoinFailed: mockClearRejoinFailed,
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

describe('a refused rejoin', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockLeaveRoom.mockClear();
    mockClearRejoinFailed.mockClear();
  });

  it('returns to the lobby without releasing the seat', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockLeaveRoom).not.toHaveBeenCalled();

    await view.unmount();
  });

  // The flag outlives the screen that reads it — the provider sits above the
  // route group. Whatever the player opens next, a game or a spectated table,
  // is bounced straight back out unless the bounce is consumed here.
  it('consumes the flag on the way out', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );

    await waitFor(() => expect(mockClearRejoinFailed).toHaveBeenCalled());

    await view.unmount();
  });
});
