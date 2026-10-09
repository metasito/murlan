import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameOverOverlay } from '@/components/GameOverOverlay';
import { t } from '@/lib/i18n';
import type { OwnLink } from '@/lib/ownLink';
import type { GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const HIDDEN = { includeHiddenElements: true };

const seat =(id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

const gameState: GameState = {
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi'), seat('player_2', 'Cveta'), seat('player_3', 'Dritan')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_0', 'player_1', 'player_2', 'player_3'],
  firstPlayMade: true,
};

async function mountBoard(link?: { ownLink: OwnLink; onRetry: () => void }) {
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
        cumulativeScores={{ player_0: 21, player_1: 8, player_2: 4, player_3: 0 }}
        handScores={{ player_0: 3, player_1: 2, player_2: 1, player_3: 0 }}
        ratingDelta={null}
        handRecorded={false}
        match={{ target: 21, length: 'match', handsPlayed: 4, over: true, winners: ['player_0'], isDraw: false, continues: false }}
        {...link}
      />
    </SafeAreaProvider>
  );
  await act(async () => {});
  return view;
}

describe('the result board over a lost link', () => {
  it('says the connection is lost and offers Riprova, which retries once', async () => {
    const onRetry = jest.fn();
    const view = await mountBoard({ ownLink: 'lost', onRetry });

    expect(view.getByTestId('result-link-lost', HIDDEN).props.children).toBe(t('onlineGame.connectionLost'));
    const retry = view.getByTestId('result-link-retry');
    expect(retry.props.accessibilityLabel).toBe(t('common.retry'));
    expect(view.getByText(t('common.retry'), HIDDEN)).toBeTruthy();
    expect(onRetry).not.toHaveBeenCalled();

    await fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it.each<OwnLink>(['up', 'dropped', 'reconnecting', 'back'])('shows neither while the link is %s', async (ownLink) => {
    const view = await mountBoard({ ownLink, onRetry: jest.fn() });
    expect(view.queryByTestId('result-link-lost', HIDDEN)).toBeNull();
    expect(view.queryByTestId('result-link-retry', HIDDEN)).toBeNull();
    await view.unmount();
  });

  it('shows neither when no link is passed', async () => {
    const view = await mountBoard();
    expect(view.queryByTestId('result-link-lost', HIDDEN)).toBeNull();
    expect(view.queryByText(t('common.retry'), HIDDEN)).toBeNull();
    await view.unmount();
  });
});
