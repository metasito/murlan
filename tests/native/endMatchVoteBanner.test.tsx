// tests/native/endMatchVoteBanner.test.tsx — the end-match vote banner
// (#896): a stray tap must not end the match unscored, the accessible name
// must say what the control does rather than repeat its own hint, and the
// live tally must land on a node of its own rather than inside the control.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/gameEngine';

import { en as locale } from '@/locales/en';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/haptics', () => ({
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'alice', username: 'Alice' } }),
}));

const seat = (id: string, name: string, extra: Partial<Player> = {}): Player => ({
  id,
  name,
  hand: [] as Card[],
  type: 'human',
  ...extra,
});

const stateWith = (over: Partial<GameState>): GameState => ({
  players: [
    seat('player_0', 'Alice'),
    seat('player_1', 'Drita', { type: 'ai', vacated: true } as Partial<Player>),
    seat('player_2', 'Carl'),
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  ...over,
});

const mockVoteToEndMatch = jest.fn();
let mockEndMatchVoteState: { votes: string[]; total: number } | null = null;

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineTable: () => ({
    gameState: stateWith({}),
    mySeatIndex: 0,
    playCards: jest.fn(),
    pass: jest.fn(),
    sendReaction: jest.fn(),
    disconnectedSeats: {},
  }),
  useOnlineTurnClock: () => ({}),
  useOnlineRoom: () => ({
    isSpectator: false,
    entrySource: 'lobby',
    leaveRoom: jest.fn(),
  }),
  useOnlineConnection: () => ({
    connected: true,
    error: null,
    reconnectNotice: null,
    playerLeft: false,
    rejoinFailed: false,
    clearError: jest.fn(),
    clearPlayerLeft: jest.fn(),
    clearRejoinFailed: jest.fn(),
  }),
  useOnlineMatch: () => ({
    matchState: { target: 21, length: 'match', over: false, winners: [], isDraw: false, continues: false },
    cumulativeScores: {},
    handScores: {},
    ratingDeltas: {},
    handRecorded: false,
    rematchVoteState: null,
    endMatchVoteState: mockEndMatchVoteState,
    rematchIntents: { yes: 0, total: 0, answers: {} },
    rematchPromptOpen: false,
    voteRematch: jest.fn(),
    voteToEndMatch: mockVoteToEndMatch,
    answerRematch: jest.fn(),
  }),
  useOnlineExchange: () => ({
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    giveExchangeCard: jest.fn(),
    acknowledgeExchange: jest.fn(),
  }),
}));

// The felt, seats and animation live in <GameTable> and need real gesture and
// audio modules this test has no business loading — everything this file
// cares about (the banner, the confirm dialog) is passed to it as props.
jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: { banners?: React.ReactNode; overlays?: (v: object) => React.ReactNode }) =>
      react.createElement(rn.View, null, [
        react.createElement(rn.View, { key: 'banners' }, props.banners ?? null),
        react.createElement(rn.View, { key: 'overlays' }, props.overlays ? props.overlays({}) : null),
      ]),
  };
});

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType })
  .default;

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const screenUnderTest = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);

describe('the end-match vote banner, a seat vacated', () => {
  beforeEach(() => {
    mockVoteToEndMatch.mockClear();
    mockEndMatchVoteState = null;
  });

  it('names what tapping it does, not its own hint, before anyone has voted', async () => {
    const view = await render(screenUnderTest());

    const button = view.getByRole('button', { name: locale['game.endMatchVoteButton'] });
    expect(button).toBeTruthy();

    await view.unmount();
  });

  it('opens a confirmation and emits nothing until the accept control is pressed', async () => {
    const view = await render(screenUnderTest());

    await fireEvent.press(view.getByRole('button', { name: locale['game.endMatchVoteButton'] }));
    expect(mockVoteToEndMatch).not.toHaveBeenCalled();

    const accept = await waitFor(() => view.getByTestId('confirm-accept'));
    await fireEvent.press(accept);
    expect(mockVoteToEndMatch).toHaveBeenCalledWith(true);

    await view.unmount();
  });

  it('reads as the withdraw control once the tally shows the viewer has voted', async () => {
    mockEndMatchVoteState = { votes: ['alice'], total: 2 };
    const view = await render(screenUnderTest());

    const button = view.getByRole('button', { name: locale['game.endMatchWithdrawButton'] });
    expect(button).toBeTruthy();
    expect(
      view.queryByRole('button', { name: locale['game.endMatchVoteButton'] })
    ).toBeNull();

    await fireEvent.press(button);
    expect(mockVoteToEndMatch).toHaveBeenCalledWith(false);

    await view.unmount();
  });

  it('puts the live tally on a node of its own, apart from the button', async () => {
    mockEndMatchVoteState = { votes: ['alice'], total: 2 };
    const view = await render(screenUnderTest());

    const tallyText = locale['game.endMatchVoteTallyVoted']
      .replace('{{votes}}', '1')
      .replace('{{total}}', '2');
    const button = view.getByRole('button', { name: locale['game.endMatchWithdrawButton'] });
    // The visible copy inside the control, and the live region's own copy —
    // two nodes, and the live region's is not inside the button's own
    // accessible subtree, so a screen reader announces it as it changes
    // rather than only when the control is focused.
    const allTallies = view.getAllByText(tallyText, { includeHiddenElements: true });
    expect(allTallies.length).toBeGreaterThanOrEqual(2);
    expect(within(button).queryAllByText(tallyText, { includeHiddenElements: true }).length).toBe(1);

    await view.unmount();
  });

  it('shows a visible cue that a second tap withdraws, not just the same tally a non-voter sees', async () => {
    mockEndMatchVoteState = { votes: ['alice'], total: 2 };
    const view = await render(screenUnderTest());

    // A sighted player who already voted must see something other than the
    // plain tally a non-voter would — otherwise a second tap withdraws with
    // no visible change (#894 review, finding 8).
    const nonVoterTally = locale['game.endMatchVoteTally']
      .replace('{{votes}}', '1')
      .replace('{{total}}', '2');
    expect(view.queryByText(nonVoterTally, { includeHiddenElements: true })).toBeNull();

    await view.unmount();
  });

  it('reverts to the base label once the tally returns to zero (a withdrawal)', async () => {
    mockEndMatchVoteState = { votes: [], total: 2 };
    const view = await render(screenUnderTest());

    expect(
      view.getByText(locale['game.endMatchVoteButton'], { includeHiddenElements: true })
    ).toBeTruthy();
    expect(view.getByRole('button', { name: locale['game.endMatchVoteButton'] })).toBeTruthy();
    expect(view.queryByRole('button', { name: locale['game.endMatchWithdrawButton'] })).toBeNull();

    await view.unmount();
  });
});
