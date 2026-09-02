// tests/native/gameOverSting.test.tsx — the end-of-hand sting matches the
// placement.
//
// `GameState.rankings` holds engine player ids (`player_0`), never display
// names, so the placement lookup has to be made with the seat's id. Looking up
// the name finds nothing at all, which makes both stings unreachable and hands
// the last-placed seat the winner's haptic.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/sounds', () => ({
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import * as Haptics from 'expo-haptics';
import { playGameWin, playGameLose } from '@/lib/sounds';
import { GameTable } from '@/components/GameTable';
import type { GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

/** Seat 0 is "Ana" and placed first; seat 1 is "Besi" and placed last. */
const finished = (rankings: string[]): GameState => ({
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings,
  firstPlayMade: true,
});

const noop = () => {};

const table = (rankings: string[], viewerSeat: number) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={finished(rankings)}
      viewerSeat={viewerSeat}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const ID_RANKINGS = ['player_0', 'player_1'];

const teamSeat = (id: string, name: string, team: 'A' | 'B'): Player => ({
  id,
  name,
  hand: [],
  type: 'human',
  team,
});

// First-and-fourth (3+0) against second-and-third (2+1): both pay 3, a draw
// (RULES.md §11). player_0 (team A) and player_3 (team A) hold 1st and 4th;
// player_1 and player_2 (team B) hold 2nd and 3rd.
const drawnTeamsTable = (viewerSeat: number) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={{
        players: [
          teamSeat('player_0', 'Ana', 'A'),
          teamSeat('player_1', 'Besi', 'B'),
          teamSeat('player_2', 'Cveta', 'B'),
          teamSeat('player_3', 'Dritan', 'A'),
        ],
        currentTurnIndex: 0,
        lastPlayedCombination: null,
        lastPlayedBy: 0,
        passCount: 0,
        gameMode: 'teams',
        roundWinner: null,
        gameOver: true,
        rankings: ['player_0', 'player_1', 'player_2', 'player_3'],
        firstPlayMade: true,
      }}
      viewerSeat={viewerSeat}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

describe('the end-of-hand sting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('plays the win sting for the seat that placed first', async () => {
    const r = await render(table(ID_RANKINGS, 0));
    expect(playGameWin).toHaveBeenCalledTimes(1);
    expect(playGameLose).not.toHaveBeenCalled();
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
    await r.unmount();
  });

  it('plays the lose sting for the seat that placed last', async () => {
    const r = await render(table(ID_RANKINGS, 1));
    expect(playGameLose).toHaveBeenCalledTimes(1);
    expect(playGameWin).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('does not hand the last-placed seat the winner’s haptic', async () => {
    const r = await render(table(ID_RANKINGS, 1));
    expect(jest.mocked(Haptics.notificationAsync)).not.toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
    await r.unmount();
  });

  it('stays silent when rankings hold display names, which is not a placement', async () => {
    const r = await render(table(['Ana', 'Besi'], 0));
    expect(playGameWin).not.toHaveBeenCalled();
    expect(playGameLose).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('stays silent for a 3-3 drawn teams manche, even for the seat that placed first', async () => {
    const r = await render(drawnTeamsTable(0));
    expect(playGameWin).not.toHaveBeenCalled();
    expect(playGameLose).not.toHaveBeenCalled();
    expect(jest.mocked(Haptics.notificationAsync)).not.toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
    await r.unmount();
  });

  it('stays silent for a 3-3 drawn teams manche for the seat that placed last too', async () => {
    const r = await render(drawnTeamsTable(3));
    expect(playGameWin).not.toHaveBeenCalled();
    expect(playGameLose).not.toHaveBeenCalled();
    await r.unmount();
  });
});
