import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameOverOverlay } from '@/components/GameOverOverlay';
import type { RematchVoteState } from '@/context/OnlineGameContext';
import { t } from '@/lib/i18n';
import type { GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const RESPONSES: Record<string, unknown> = {
  '/api/stats/me': { currentStreak: 1, bestStreak: 1 },
  '/api/stats/history': [
    { finishedAt: '2026-10-10T10:00:00.000Z', placement: 1, playerCount: 2, points: 1, ratingDelta: null, replayId: 'r1' },
  ],
  '/api/ratings/me': { rating: 1000, games: 1, provisional: true },
  '/api/replays/r1': { id: 'r1', seats: [], moves: [], rankings: [] },
};

const client = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = (queryKey as string[]).join('/');
          if (!(url in RESPONSES)) throw new Error(`no stub for ${url}`);
          return RESPONSES[url];
        },
      },
    },
  });

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

const gameState: GameState = {
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besnik')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_0', 'player_1'],
  firstPlayMade: true,
};

async function openBreakdown(over: boolean, voteState: RematchVoteState | null = null) {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client()}>
        <GameOverOverlay
          gameState={gameState}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={voteState}
          myUserId="u1"
          mySeatIndex={0}
          cumulativeScores={{ player_0: 1, player_1: 0 }}
          handScores={{ player_0: 1, player_1: 0 }}
          ratingDelta={null}
          handRecorded
          match={{ target: 21, length: over ? 'single' : 'match', handsPlayed: 1, over, winners: over ? ['player_0'] : [], isDraw: false, continues: true }}
        />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  await fireEvent.press(view.getByLabelText(t('handBreakdown.toggleA11yLabel')));
  await view.findByLabelText(/^Piazzamento|^Finish/);
  await act(async () => {});
  return view;
}

const REPLAY = t('handBreakdown.openReplayA11yLabel');
const DEFERRED = t('handBreakdown.replayAfterLeaving');

describe('the replay in the breakdown of an online hand', () => {
  it('is offered once the match is over and the viewer has not asked for another', async () => {
    const view = await openBreakdown(true);
    expect(view.getByLabelText(REPLAY)).toBeTruthy();
    expect(view.queryByText(DEFERRED)).toBeNull();
    await view.unmount();
  });

  it('is deferred while the match still has a manche to deal', async () => {
    const view = await openBreakdown(false);
    expect(view.queryByLabelText(REPLAY)).toBeNull();
    expect(view.getByText(DEFERRED)).toBeTruthy();
    await view.unmount();
  });

  it('is deferred once the viewer has voted for a new match', async () => {
    const view = await openBreakdown(true, { votes: ['u1'], total: 2 });
    expect(view.queryByLabelText(REPLAY)).toBeNull();
    expect(view.getByText(DEFERRED)).toBeTruthy();
    await view.unmount();
  });
});
