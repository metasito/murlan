// tests/native/gameOverSting.test.tsx — the end-of-hand sting matches the
// placement.
//
// `GameState.rankings` holds engine player ids (`player_0`), never display
// names, so the placement lookup has to be made with the seat's id. Looking up
// the name finds nothing at all, which makes both stings unreachable and hands
// the last-placed seat the winner's haptic.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import { Hold } from '@/lib/theme';
import type { GameState, Player } from '@/lib/game/gameEngine';
import { bootFeedback, ctxAt, haptics, settle as advance, sounds, startsOf } from './helpers/feedback';

let mockReduceMotion = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduceMotion,
  setMotionPreference: () => {},
  getMotionPreference: () => 'system',
}));

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
const scoresFor = (rankings: string[]) => Object.fromEntries(rankings.map((id, i) => [id, rankings.length - 1 - i]));

const table = (
  rankings: string[],
  viewerSeat: number,
  gameOver = true,
  { matchOver = false, matchWinners = [] as string[] } = {}
) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={{ ...finished(rankings), gameOver }}
      handScores={scoresFor(rankings)}
      matchOver={matchOver}
      matchWinners={matchWinners}
      viewerSeat={viewerSeat}
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
// (GAME-RULES.md §11). player_0 (team A) and player_3 (team A) hold 1st and 4th;
// player_1 and player_2 (team B) hold 2nd and 3rd. Scores are given
// explicitly (not left to GameTable's empty default) so this exercises a
// hand `isDrawnHand` actually knows is a draw, not one it has no scores for.
const DRAWN_TEAMS_RANKINGS = ['player_0', 'player_1', 'player_2', 'player_3'];
const DRAWN_TEAMS_SCORES = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
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
        rankings: DRAWN_TEAMS_RANKINGS,
        firstPlayMade: true,
      }}
      handScores={DRAWN_TEAMS_SCORES}
      viewerSeat={viewerSeat}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

// Team A (player_0 + player_3) holds 1st and 3rd — 3+1 = 4 — against team B
// (player_1 + player_2) holding 2nd and 4th — 2+0 = 2. Not a draw: team A
// wins the manche, even though player_3 personally placed third.
const WON_TEAMS_RANKINGS = ['player_0', 'player_1', 'player_3', 'player_2'];
const WON_TEAMS_SCORES = { player_0: 3, player_1: 2, player_3: 1, player_2: 0 };
const wonTeamsTable = (viewerSeat: number) => (
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
        rankings: WON_TEAMS_RANKINGS,
        firstPlayMade: true,
      }}
      handScores={WON_TEAMS_SCORES}
      viewerSeat={viewerSeat}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const STING_MS = Hold.sting;
const settle = (ms = STING_MS) => advance(ms);

describe('the end-of-hand sting', () => {
  beforeEach(async () => {
    mockReduceMotion = false;
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules the win sting in the engine 300 ms after the landing, which with no flight is now', async () => {
    const t0 = performance.now();
    const r = await render(table(ID_RANKINGS, 0));
    await advance();
    expect(startsOf('mancheWon')).toEqual([expect.closeTo(ctxAt(t0 + STING_MS), 2)]);
    await r.unmount();
  });

  it('a sting already in the engine survives the table unmounting (#5)', async () => {
    const r = await render(table(ID_RANKINGS, 0));
    await advance();
    await r.unmount();
    expect(startsOf('mancheWon')).toHaveLength(1);
  });

  it('a finished partita sounds its own sting, with the haptic leading by 300 ms', async () => {
    const r = await render(table(ID_RANKINGS, 0, true, { matchOver: true, matchWinners: ['player_0'] }));
    await advance(300);
    expect(sounds()).toContain('partitaWon');
    expect(sounds()).not.toContain('mancheWon');
    expect(haptics()).toEqual(['impactMedium', 'notificationSuccess']);
    await r.unmount();
  });

  it('under reduced motion a finished partita still leads with its haptic, the sting 300 ms after', async () => {
    mockReduceMotion = true;
    const t0 = performance.now();
    const r = await render(table(ID_RANKINGS, 0, true, { matchOver: true, matchWinners: ['player_0'] }));
    await advance(300);
    expect(haptics()).toEqual(['impactMedium', 'notificationSuccess']);
    expect(startsOf('partitaWon')).toEqual([expect.closeTo(ctxAt(t0 + 300), 2)]);
    await r.unmount();
  });

  it('plays the win sting for the seat that placed first', async () => {
    const r = await render(table(ID_RANKINGS, 0));
    await settle();
    expect(sounds()).toContain('mancheWon');
    expect(sounds()).not.toContain('mancheLost');
    expect(haptics()).toContain('notificationSuccess');
    await r.unmount();
  });

  it('plays the lose sting for the seat that placed last', async () => {
    const r = await render(table(ID_RANKINGS, 1));
    await settle();
    expect(sounds()).toContain('mancheLost');
    expect(sounds()).not.toContain('mancheWon');
    await r.unmount();
  });

  it('does not hand the last-placed seat the winner’s haptic', async () => {
    const r = await render(table(ID_RANKINGS, 1));
    await settle();
    expect(haptics()).not.toContain('notificationSuccess');
    await r.unmount();
  });

  it('stays silent when rankings hold display names, which is not a placement', async () => {
    const r = await render(table(['Ana', 'Besi'], 0));
    await settle();
    expect(sounds()).not.toContain('mancheWon');
    expect(sounds()).not.toContain('mancheLost');
    await r.unmount();
  });

  it('sounds the neutral sting for a 3-3 drawn teams manche, with no haptic, even for the seat that placed first', async () => {
    const r = await render(drawnTeamsTable(0));
    await settle();
    expect(sounds().filter((s) => s !== 'deal')).toEqual(['mancheNeutral']);
    expect(haptics()).toEqual([]);
    await r.unmount();
  });

  it('sounds the neutral sting for a 3-3 drawn teams manche, with no haptic, for the seat that placed last too', async () => {
    const r = await render(drawnTeamsTable(3));
    await settle();
    expect(sounds().filter((s) => s !== 'deal')).toEqual(['mancheNeutral']);
    expect(haptics()).toEqual([]);
    await r.unmount();
  });

  // player_3 (seat 3) placed third individually, but its team took the
  // manche — the win sting now credits the whole team, not only whichever
  // partner happened to go out first.
  it('credits the win sting to a third-placed partner on the winning team', async () => {
    const r = await render(wonTeamsTable(3));
    await settle();
    expect(sounds()).toContain('mancheWon');
    expect(sounds()).not.toContain('mancheLost');
    expect(haptics()).toContain('notificationSuccess');
    await r.unmount();
  });

  // player_2 (seat 2) placed fourth on the losing team, and player_1 (seat
  // 1) placed second on that same losing team — both partners lose, not
  // only the one who finished last.
  it('credits the lose sting to a second-placed partner on the losing team', async () => {
    const r = await render(wonTeamsTable(1));
    await settle();
    expect(sounds()).toContain('mancheLost');
    expect(sounds()).not.toContain('mancheWon');
    await r.unmount();
  });

  // Online, `game:state` (gameOver: true) reaches the client before the
  // separate, unawaited `game:over` carries the scores — two renders, the
  // first with the real rankings and no scores at all. player_3 (seat 3) is
  // on the winning team (WON_TEAMS_SCORES).
  it('waits for the real scores before firing the sting, instead of latching a decision made with none', async () => {
    const inProgress = (
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
            gameOver: false,
            rankings: [],
            firstPlayMade: true,
          }}
          viewerSeat={3}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
        />
      </SafeAreaProvider>
    );
    const stateArrived = (handScores: Record<string, number>) => (
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
            rankings: WON_TEAMS_RANKINGS,
            firstPlayMade: true,
          }}
          handScores={handScores}
          viewerSeat={3}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
        />
      </SafeAreaProvider>
    );

    const r = await render(inProgress);

    // `game:state`: gameOver flips true, rankings are the real finish order —
    // but the scores that decide won/lost/drawn haven't arrived yet.
    await act(async () => r.rerender(stateArrived({})));
    await settle();
    expect(sounds()).not.toContain('mancheWon');
    expect(sounds()).not.toContain('mancheLost');

    // `game:over`: the real scores land, same gameOver, same rankings.
    await act(async () => r.rerender(stateArrived(WON_TEAMS_SCORES)));
    await settle();
    expect(sounds()).toContain('mancheWon');
    expect(sounds()).not.toContain('mancheLost');

    await r.unmount();
  });
});
