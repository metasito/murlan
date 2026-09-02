// tests/native/pendingHandScoresOverlay.test.tsx — #808: a client that has
// not yet seen `game:over` for the current manche (a rejoin landing ahead of
// it, or the same client mid-broadcast) holds an incomplete `handScores`.
// `isDrawnHand` already refuses to read that as a draw, but nothing gated
// `rankings[0]`/`rows[0]` on the same completeness check, so an unresolved
// manche fell through to naming a team that may not have won at all.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { GameOverOverlay } from '@/components/GameOverOverlay';
import { t } from '@/lib/i18n';
import type { GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string, team: 'A' | 'B'): Player => ({
  id,
  name,
  hand: [],
  type: 'human',
  team,
});

const players = [
  seat('player_0', 'Ana', 'A'),
  seat('player_1', 'Besi', 'B'),
  seat('player_2', 'Cveta', 'B'),
  seat('player_3', 'Dritan', 'A'),
];

// The identity itself is what is under test — team A (rankings[0]'s team) is
// deliberately what the pre-fix overlay named regardless of whether Ana
// actually finished first with real points behind it.
const rankings = ['player_0', 'player_1', 'player_2', 'player_3'];

const notificationAsync = Haptics.notificationAsync as unknown as ReturnType<typeof jest.fn>;

describe('a teams manche this client has no game:over for yet celebrates nobody', () => {
  const gameState: GameState = {
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: 'teams',
    roundWinner: null,
    gameOver: true,
    rankings,
    firstPlayMade: true,
  };

  it('names no team when handScores is empty', async () => {
    notificationAsync.mockClear();
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={gameState}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u1"
          mySeatIndex={0}
          cumulativeScores={{}}
          handScores={{}}
          ratingDelta={null}
          handRecorded={false}
          match={{
            target: 21,
            length: 'match',
            handsPlayed: 1,
            over: false,
            winners: [],
            isDraw: false,
            continues: true,
          }}
        />
      </SafeAreaProvider>
    );
    await act(async () => {});

    // The standings rows legitimately print "Team A"/"Team B" as each seat's
    // own label, so the celebration's own name node — not any occurrence of
    // the text on screen — is what must read empty: rankings[0] (Ana/team A)
    // is exactly the wrong guess an incomplete scoreboard cannot rule out.
    expect(view.getByTestId('winner-celebration-name').props.children).toBe('');
    // No draw claim either — the hand's real outcome is simply not known yet.
    expect(view.queryByText(t('result.handDrawTitle'))).toBeNull();
    expect(notificationAsync.mock.calls).toEqual([]);
    await view.unmount();
  });

  it('names the real winner once handScores actually arrives', async () => {
    notificationAsync.mockClear();
    // Ana's team (A) genuinely won this manche: 3 + 0 against 1 + 1.
    const handScores = { player_0: 3, player_1: 1, player_2: 1, player_3: 0 };
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameOverOverlay
          gameState={gameState}
          topPad={0}
          bottomPad={0}
          onLeave={() => {}}
          onVoteRematch={() => {}}
          voteState={null}
          myUserId="u1"
          mySeatIndex={0}
          cumulativeScores={handScores}
          handScores={handScores}
          ratingDelta={null}
          handRecorded={true}
          match={{
            target: 21,
            length: 'match',
            handsPlayed: 1,
            over: false,
            winners: [],
            isDraw: false,
            continues: true,
          }}
        />
      </SafeAreaProvider>
    );
    await act(async () => {});

    // Once the real scores are in, the completeness check must not itself
    // become a second way to hide a genuine winner.
    expect(view.getByTestId('winner-celebration-name').props.children).toBe(
      t('lobby.team', { team: 'A' })
    );
    await view.unmount();
  });
});
