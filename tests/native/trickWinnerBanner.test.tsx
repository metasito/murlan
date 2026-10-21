// tests/native/trickWinnerBanner.test.tsx — the trick-winner tag over the pile
// is announced once per trick, for every trick.
//
// The seat that wins a trick leads the next one, so the same seat winning two
// tricks in a row is ordinary play rather than an edge case: with two players
// one closing pass follows another with the same seat named, and with three a
// pass that closes nothing comes between. The tag has to arrive both times
// either way, and the sting with the close that raises it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getAnimatedStyle } from 'react-native-reanimated';

// Reduced motion collapses a played card's flight to a single timer, so the
// pile reaches its settled state on a tick rather than on a spring callback.
import { bootFeedback, startsOf } from './helpers/feedback';
import { GameTable } from '@/components/GameTable';
import type { Card, Combination, GameState, Player } from '@/lib/game/gameEngine';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import { setMotion } from './harness/env';
import { BOT_MOVE_DELAY_MS } from '@/server/game/gameTimers';
import { Motion } from '@/lib/theme';
import { aThreePlayed } from '../support/game';
import { replayStateAt, type ReplayDto } from '@/lib/game/replay';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const WINNER = 'Besi';
const WINNER_SEAT = 1;

const KING: Card = { id: 'K_hearts', rank: 'K', suit: 'hearts', isJoker: false };
const LED: Combination = { type: 'single', cards: [KING], strength: 13 };

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

const state = (over: Partial<GameState>): GameState => ({
  players: [seat('player_0', 'Ana'), seat('player_1', WINNER)],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: WINNER_SEAT,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
  ...over,
});

/** The pass that closed the trick in the winner's favour, as move `seq`. */
const closed = (seq: number) => state({ lastMove: { seq, kind: 'pass', seat: 0, closedTrick: true } });
/** The winner leading the next trick. */
const leading = (seq: number) => state({ lastPlayedCombination: LED, lastMove: { seq, kind: 'play', seat: WINNER_SEAT } });
/** A pass that closed nothing, three-handed. */
const between = (seq: number) => state({ lastMove: { seq, kind: 'pass', seat: 0, closedTrick: false } });

const noop = () => {};

const table = (gameState: GameState, scrubbed = false) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      scrubbed={scrubbed}
      viewerSeat={0}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

/** The tag's scope over the pile, not the same name on its seat. */
const pileArea = () => within(screen.getByTestId('pile-area'));
const plate = () => pileArea().getByTestId('notice-trickWinner', { includeHiddenElements: true });
const STAR = String.fromCodePoint(Number(Ionicons.glyphMap.star));
const tagShown = async () => {
  await act(async () => {
    jest.advanceTimersByTime(Motion.mark.enter + 16);
  });
  expect((getAnimatedStyle(plate()) as { opacity?: number }).opacity).toBe(1);
  within(plate()).getByText(WINNER, { includeHiddenElements: true });
  within(plate()).getByText(STAR, { includeHiddenElements: true });
};
/** Not present, hidden or otherwise — the tag unmounts on dismissal rather
 *  than fading in place, so a plain absence check is the real claim here. */
const tagGone = () => pileArea().queryByText(WINNER, { includeHiddenElements: true }) === null;

beforeEach(() => setMotion('on'));

describe('the trick-winner tag', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the winner, dismisses itself, and shows the same winner again next trick', async () => {
    const r = await render(table(closed(2)));
    await tagShown();

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(tagGone()).toBe(true);

    // The pass that ends nothing, three-handed.
    await act(async () => r.rerender(table(between(3))));
    expect(tagGone()).toBe(true);
    // Its own pass sound holds the mix, as a turn's wait does at a real table.
    await act(async () => {
      jest.advanceTimersByTime(BOT_MOVE_DELAY_MS);
    });

    await act(async () => r.rerender(table(closed(4))));
    await tagShown();
    expect(startsOf('trick_win')).toHaveLength(1);

    await r.unmount();
  });

  it('announces the second win when the same seat takes it', async () => {
    // Two-handed: the winner leads the next trick and takes it as well, so
    // both closes name the same seat.
    const r = await render(table(closed(5)));
    await tagShown();

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(tagGone()).toBe(true);

    await act(async () => r.rerender(table(leading(6))));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(tagGone()).toBe(true);

    await act(async () => r.rerender(table(closed(7))));
    await tagShown();
    expect(startsOf('trick_win')).toHaveLength(1);

    await r.unmount();
  });

  it('announces a later round\'s close that repeats an earlier round\'s count and seat', async () => {
    // `seq` starts again at every deal, so the same move number comes round again.
    const r = await render(table(closed(8)));
    await tagShown();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(tagGone()).toBe(true);

    await act(async () => r.rerender(table(state({ lastMove: { seq: 0, kind: 'deal' } }))));
    await act(async () => r.rerender(table(leading(7))));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await act(async () => r.rerender(table(closed(8))));
    await tagShown();

    await r.unmount();
  });
});

const QUEEN: Card = { id: 'Q_hearts', rank: 'Q', suit: 'hearts', isJoker: false };
const NEXT_LEAD: Combination = { type: 'single', cards: [QUEEN], strength: 12 };
/** Besi leads the King, Ana's pass closes the trick, Besi leads the Queen. */
const REPLAY = {
  id: 'r1',
  finishedAt: '2026-10-16T10:00:00.000Z',
  gameMode: 'free_for_all',
  seats: [
    { seatIndex: 0, userId: 'u0', name: 'Ana' },
    { seatIndex: 1, userId: 'u1', name: WINNER },
  ],
  finishingOrder: [],
  moves: [
    { seat: WINNER_SEAT, combo: LED, handCounts: [3, 2] },
    { seat: 0, combo: null, handCounts: [3, 2] },
    { seat: WINNER_SEAT, combo: NEXT_LEAD, handCounts: [3, 1] },
  ],
} as unknown as ReplayDto;
/** The replay at `index`; `scrubbed` when the screen reached it by anything but a step forward. */
const at = (index: number, scrubbed = false) => table(replayStateAt(REPLAY, index), scrubbed);
const onFelt = (card: Card) => pileArea().queryByLabelText(cardSpokenName(card, t), { includeHiddenElements: true });

describe('the trick-winner tag in a replay', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // D4: a replay shows the tag as live play does, when it steps onto the pass that closed the trick.
  it('shows the winner once the scrubber reaches the closing pass', async () => {
    const r = await render(at(0));
    expect(tagGone()).toBe(true);
    // Past the lead's landing, whose pile-up window would mask the sting.
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    await act(async () => r.rerender(at(1)));
    await tagShown();
    expect(startsOf('trick_win')).toHaveLength(1);

    await r.unmount();
  });

  it('shows the winner again when the scrubber steps back onto the closing pass', async () => {
    const r = await render(at(0));
    await act(async () => r.rerender(at(1)));
    await tagShown();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(tagGone()).toBe(true);

    await act(async () => r.rerender(at(2)));
    await act(async () => r.rerender(at(1, true)));
    await tagShown();

    await r.unmount();
  });

  it('clears the felt on a step back onto the closing pass, rather than holding the later lead under the tag', async () => {
    const r = await render(at(2));
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(onFelt(QUEEN)).not.toBeNull();

    await act(async () => r.rerender(at(1, true)));
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(onFelt(QUEEN)).toBeNull();

    await r.unmount();
  });

  it('is silent on a scrub: a step back or a jump onto the closing pass sounds neither the pass nor the sting', async () => {
    const back = await render(at(2));
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await act(async () => back.rerender(at(1, true)));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(startsOf('pass')).toHaveLength(0);
    expect(startsOf('trick_win')).toHaveLength(0);
    await back.unmount();

    const jump = await render(at(-1));
    await act(async () => jump.rerender(at(1, true)));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(startsOf('pass')).toHaveLength(0);
    expect(startsOf('trick_win')).toHaveLength(0);
    await jump.unmount();
  });
});
