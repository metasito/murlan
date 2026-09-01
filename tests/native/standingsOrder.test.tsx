// tests/native/standingsOrder.test.tsx — the number beside a standings row
// always explains its position.
//
// Both end-of-manche screens list the same table: the online overlay and
// app/result.tsx. Each row prints a running match total, so a row printing a
// bigger total below a smaller one means the list was ordered by something
// other than the thing it is showing. lib/standings.ts is the one place that
// order is decided; these are the two screens that have to render it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

// Hoisted above the imports, so it reads these back at render time rather than
// closing over them — which is what the `mock` prefix permits.
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: mockState,
    match: mockMatch,
    tableWantsRematch: false,
    startNextHand: () => {},
    startNewMatch: () => {},
    chooseExchangeCard: () => {},
    resetGame: () => {},
  }),
}));

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ResultScreen from '@/app/result';
import { GameOverOverlay } from '@/components/GameOverOverlay';
import type { GameState, Player } from '@/lib/gameEngine';
import type { MatchState } from '@/context/GameContext';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

// The table from the report: the manche finished shtiz7, rotonmeta, KenziGmbH,
// but KenziGmbH carried more match points into it than rotonmeta did. Ordering
// by the manche puts 3pt above 4pt.
const FINISH_ORDER = ['player_0', 'player_1', 'player_2'];
// Keyed by engine player id, as `game:over` states every score and winner —
// a display name is not an identity, and two seats can share one.
const TOTALS = { player_0: 14, player_1: 3, player_2: 4 };
const AWARDED = { player_0: 2, player_1: 1, player_2: 0 };

const mockState: GameState = {
  players: [seat('player_0', 'shtiz7'), seat('player_1', 'rotonmeta'), seat('player_2', 'KenziGmbH')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: FINISH_ORDER,
  firstPlayMade: true,
};

const mockMatch: MatchState = {
  length: 'match',
  target: 14,
  scores: { player_0: 14, player_1: 3, player_2: 4 },
  hands: [{ rankings: FINISH_ORDER, pointsAwarded: { player_0: 2, player_1: 1, player_2: 0 } }],
  over: true,
  winners: ['player_0'],
  isDraw: false,
};

interface Queryable {
  getAllByText: (matcher: RegExp) => { props: Record<string, unknown> }[];
  getAllByTestId: (id: string) => { props: Record<string, unknown> }[];
}

/**
 * Every match total the board printed, top to bottom. By testID rather than by
 * shape: the stats beside the standings print bare integers too.
 */
const printedTotals = (view: Queryable) =>
  view.getAllByTestId('rank-total').map((n) => Number(String(n.props.children)));

/**
 * What each standings row says the manche awarded it, top to bottom. The
 * celebration above the list repeats the winner's name, so the rows are read
 * by their deltas — nothing else on either screen prints a bare `+N`.
 */
const printedDeltas = (view: Queryable) =>
  view.getAllByText(/^\+\d+$/).map((n) => String(n.props.children));

function neverClimbs(totals: number[]) {
  for (let i = 1; i < totals.length; i++) {
    expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
  }
}

describe('a standings row is explained by the number beside it', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('online: the overlay lists by match total, not by the manche just played', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={mockState}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u1"
          cumulativeScores={TOTALS}
          ratingDelta={null}
        handScores={AWARDED}
          match={{
            target: 14,
            length: 'match',
            handsPlayed: 3,
            over: true,
            winners: ['player_0'],
            isDraw: false,
            continues: false,
          }}
        />
      </SafeAreaProvider>
    );
    await act(async () => {});

    const totals = printedTotals(view);
    expect(totals).toEqual([14, 4, 3]);
    neverClimbs(totals);

    await view.unmount();
  });

  // A seat on nothing is still a seat. Guarding the badge on a non-zero score
  // leaves a hole in the column exactly where the standings are tightest.
  it('online: a player on no points still shows a number', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={mockState}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u1"
          cumulativeScores={{ player_0: 2, player_1: 0, player_2: 0 }}
          ratingDelta={null}
        handScores={AWARDED}
          match={{
            target: 14,
            length: 'match',
            handsPlayed: 3,
            over: false,
            winners: [],
            isDraw: false,
            continues: true,
          }}
        />
      </SafeAreaProvider>
    );
    await act(async () => {});

    expect(printedTotals(view)).toEqual([2, 0, 0]);

    await view.unmount();
  });

  it('offline: the result screen lists the same table the same way', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ResultScreen />
      </SafeAreaProvider>
    );
    await act(async () => {});

    // shtiz7 took the manche (+2) and rotonmeta came second (+1), but
    // KenziGmbH sits above rotonmeta on match points — so the deltas run out
    // of order down the list while the totals do not.
    expect(printedDeltas(view)).toEqual(['+2', '+0', '+1']);

    await view.unmount();
  });
});
