// tests/native/roundOverSting.test.tsx — the end-of-round sting matches the
// placement.
//
// `GameState.finishingOrder` holds engine player ids (`player_0`), never display
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
import { setMotion } from './harness/env';
import { emptyRankTally } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

/** Seat 0 is "Ana" and placed first; seat 1 is "Besi" and placed last. */
const finished = (finishingOrder: string[]): GameState => ({
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: true,
  finishingOrder,
  firstPlayMade: true,
  playedRanks: emptyRankTally(),
  lastMove: { seq: 0, kind: 'deal' },
});

const noop = () => {};
const scoresFor = (finishingOrder: string[]) => Object.fromEntries(finishingOrder.map((id, i) => [id, finishingOrder.length - 1 - i]));

const table = (
  finishingOrder: string[],
  viewerSeat: number,
  roundOver = true,
  { matchOver = false, matchWinners = [] as string[] } = {}
) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={{ ...finished(finishingOrder), roundOver }}
      placementPoints={scoresFor(finishingOrder)}
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

const ID_FINISHING_ORDER = ['player_0', 'player_1'];

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
// round `isDrawnRound` actually knows is a draw, not one it has no scores for.
const DRAWN_TEAMS_FINISHING_ORDER = ['player_0', 'player_1', 'player_2', 'player_3'];
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
        trickWinner: null,
        roundOver: true,
        finishingOrder: DRAWN_TEAMS_FINISHING_ORDER,
        firstPlayMade: true,
        playedRanks: emptyRankTally(),
        lastMove: { seq: 0, kind: 'deal' },
      }}
      placementPoints={DRAWN_TEAMS_SCORES}
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
// wins the round, even though player_3 personally placed third.
const WON_TEAMS_FINISHING_ORDER = ['player_0', 'player_1', 'player_3', 'player_2'];
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
        trickWinner: null,
        roundOver: true,
        finishingOrder: WON_TEAMS_FINISHING_ORDER,
        firstPlayMade: true,
        playedRanks: emptyRankTally(),
        lastMove: { seq: 0, kind: 'deal' },
      }}
      placementPoints={WON_TEAMS_SCORES}
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

describe('the end-of-round sting', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules the win sting in the engine 300 ms after the landing, which with no flight is now', async () => {
    const t0 = performance.now();
    const r = await render(table(ID_FINISHING_ORDER, 0));
    await advance();
    expect(startsOf('roundWon')).toEqual([expect.closeTo(ctxAt(t0 + STING_MS), 2)]);
    await r.unmount();
  });

  it('a sting already in the engine survives the table unmounting (#5)', async () => {
    const r = await render(table(ID_FINISHING_ORDER, 0));
    await advance();
    await r.unmount();
    expect(startsOf('roundWon')).toHaveLength(1);
  });

  it('a finished match sounds its own sting, with the haptic leading by 300 ms', async () => {
    const r = await render(table(ID_FINISHING_ORDER, 0, true, { matchOver: true, matchWinners: ['player_0'] }));
    await advance(300);
    expect(sounds()).toContain('matchWon');
    expect(sounds()).not.toContain('roundWon');
    expect(haptics()).toEqual(['impactMedium', 'notificationSuccess']);
    await r.unmount();
  });

  it('under reduced motion a finished match still leads with its haptic, the sting 300 ms after', async () => {
    await setMotion('on');
    const t0 = performance.now();
    const r = await render(table(ID_FINISHING_ORDER, 0, true, { matchOver: true, matchWinners: ['player_0'] }));
    await advance(300);
    expect(haptics()).toEqual(['impactMedium', 'notificationSuccess']);
    expect(startsOf('matchWon')).toEqual([expect.closeTo(ctxAt(t0 + 300), 2)]);
    await r.unmount();
  });

  it('plays the win sting for the seat that placed first', async () => {
    const r = await render(table(ID_FINISHING_ORDER, 0));
    await settle();
    expect(sounds()).toContain('roundWon');
    expect(sounds()).not.toContain('roundLost');
    expect(haptics()).toContain('notificationSuccess');
    await r.unmount();
  });

  it('plays the lose sting for the seat that placed last', async () => {
    const r = await render(table(ID_FINISHING_ORDER, 1));
    await settle();
    expect(sounds()).toContain('roundLost');
    expect(sounds()).not.toContain('roundWon');
    await r.unmount();
  });

  it('does not hand the last-placed seat the winner’s haptic', async () => {
    const r = await render(table(ID_FINISHING_ORDER, 1));
    await settle();
    expect(haptics()).not.toContain('notificationSuccess');
    await r.unmount();
  });

  it('stays silent when finishingOrder hold display names, which is not a placement', async () => {
    const r = await render(table(['Ana', 'Besi'], 0));
    await settle();
    expect(sounds()).not.toContain('roundWon');
    expect(sounds()).not.toContain('roundLost');
    await r.unmount();
  });

  it('sounds the neutral sting for a 3-3 drawn teams round, with no haptic, even for the seat that placed first', async () => {
    const r = await render(drawnTeamsTable(0));
    await settle();
    expect(sounds().filter((s) => s !== 'deal')).toEqual(['roundNeutral']);
    expect(haptics()).toEqual([]);
    await r.unmount();
  });

  it('sounds the neutral sting for a 3-3 drawn teams round, with no haptic, for the seat that placed last too', async () => {
    const r = await render(drawnTeamsTable(3));
    await settle();
    expect(sounds().filter((s) => s !== 'deal')).toEqual(['roundNeutral']);
    expect(haptics()).toEqual([]);
    await r.unmount();
  });

  // player_3 (seat 3) placed third individually, but its team took the
  // round — the win sting now credits the whole team, not only whichever
  // partner happened to go out first.
  it('credits the win sting to a third-placed partner on the winning team', async () => {
    const r = await render(wonTeamsTable(3));
    await settle();
    expect(sounds()).toContain('roundWon');
    expect(sounds()).not.toContain('roundLost');
    expect(haptics()).toContain('notificationSuccess');
    await r.unmount();
  });

  // player_2 (seat 2) placed fourth on the losing team, and player_1 (seat
  // 1) placed second on that same losing team — both partners lose, not
  // only the one who finished last.
  it('credits the lose sting to a second-placed partner on the losing team', async () => {
    const r = await render(wonTeamsTable(1));
    await settle();
    expect(sounds()).toContain('roundLost');
    expect(sounds()).not.toContain('roundWon');
    await r.unmount();
  });

  // Online, `game:state` (roundOver: true) reaches the client before the
  // separate, unawaited `game:round_over` carries the scores — two renders, the
  // first with the real finishingOrder and no scores at all. player_3 (seat 3) is
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
            trickWinner: null,
            roundOver: false,
            finishingOrder: [],
            firstPlayMade: true,
            playedRanks: emptyRankTally(),
            lastMove: { seq: 0, kind: 'deal' },
          }}
          viewerSeat={3}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
        />
      </SafeAreaProvider>
    );
    const stateArrived = (placementPoints: Record<string, number>) => (
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
            trickWinner: null,
            roundOver: true,
            finishingOrder: WON_TEAMS_FINISHING_ORDER,
            firstPlayMade: true,
            playedRanks: emptyRankTally(),
            lastMove: { seq: 0, kind: 'deal' },
          }}
          placementPoints={placementPoints}
          viewerSeat={3}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
        />
      </SafeAreaProvider>
    );

    const r = await render(inProgress);

    // `game:state`: roundOver flips true, finishingOrder are the real finish order —
    // but the scores that decide won/lost/drawn haven't arrived yet.
    await act(async () => r.rerender(stateArrived({})));
    await settle();
    expect(sounds()).not.toContain('roundWon');
    expect(sounds()).not.toContain('roundLost');

    // `game:round_over`: the real scores land, same roundOver, same finishingOrder.
    await act(async () => r.rerender(stateArrived(WON_TEAMS_SCORES)));
    await settle();
    expect(sounds()).toContain('roundWon');
    expect(sounds()).not.toContain('roundLost');

    await r.unmount();
  });
});
