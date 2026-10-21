// tests/native/matchEndsOnTable.test.tsx — the last round of a match ends on the felt, offline
// and online: no route change and no results overlay; the score pill becomes the board with the
// winner and both actions; a tap during the ending, or reduced motion, jumps to the settled board.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setMotionPreference } from '@/lib/accessibility';
import { SETTINGS_KEY } from '@/lib/storageKeys';
import type { GameState, Player } from '@/lib/game/gameEngine';
import { matchEndingOnsets } from '@/lib/timeline/matchEnding';
import { t } from '@/lib/i18n';
import { Layer } from '@/lib/theme';
import { StyleSheet } from 'react-native';
import { aThreePlayed, state } from '../support/game';
import { useGameTable } from '@/context/GameContext';
import { offlineSave, renderAppHook } from './harness/renderApp';
import { roundOver, wire } from './harness/wire';
import type { FakeSocket } from './mocks/socketIo';

const seat = (i: number): Player => ({ id: `player_${i}`, name: ['Ana', 'Luan', 'Erion', 'Besa'][i], hand: [], type: i === 0 ? 'human' : 'bot' });
const ENDED: GameState = state({
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: true,
  finishingOrder: ['player_1', 'player_0', 'player_2', 'player_3'],
  firstPlayMade: true,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
});
const SCORES = { player_0: 12, player_1: 22, player_2: 6, player_3: 3 };
const ROUND = { player_0: 1, player_1: 3, player_2: 0, player_3: 0 };

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() } }));

/** Luan and Erion are out, Luan first; Ana's last card ends the round, and Luan's 20 points end the match. */
const LAST_CARD = { id: '3_spades', rank: '3', suit: 'spades', isJoker: false } as const;
const ENDING: GameState = state({
  ...ENDED,
  players: [
    { ...seat(0), hand: [LAST_CARD] },
    seat(1),
    seat(2),
    { ...seat(3), hand: [{ id: '4_spades', rank: '4', suit: 'spades', isJoker: false }] },
  ],
  roundOver: false,
  finishingOrder: ['player_1', 'player_2'],
});

/** The server's word on the last round, which `over` sets for the viewer `alice`. */
const lastRound = (over: { ratingDeltas?: Record<string, number>; ratingsAfter?: Record<string, { rating: number; rounds: number }>; recorded?: boolean; matchContinues?: boolean } = {}) =>
  roundOver(ENDED, ROUND, {
    totals: SCORES,
    roundsPlayed: 6,
    matchOver: true,
    matchWinnerIds: ['player_1'],
    matchContinues: true,
    ...over,
  });

const OfflineGameScreen = (require('@/app/game') as { default: React.ComponentType }).default;
const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const HIDDEN = { includeHiddenElements: true };
const { board, settled } = matchEndingOnsets(4);
/** `ms` of frames: a flight's clock runs on frame callbacks, which one long jump skips. */
const advance = async (ms: number) => {
  for (let t = 0; t < ms; t += 16) await act(async () => void jest.advanceTimersByTime(Math.min(16, ms - t)));
};
type Screen = 'offline' | 'online';
/** Past the deal of the saved table, so the last card is thrown onto a table at rest. */
const DEALT = 3_000;
/** The flight of Ana's last card: the ending's onsets count from its landing, as online they count from the finished table. */
const THROWN = 300;
let live: FakeSocket;

/**
 * The table the match ends on. Offline, Ana has played the last card of a saved match; online, the server
 * sends the finished table and then its word on the round, unless `scored` is false. `served` stands the
 * online table's word up offline too, so an offline screen that showed it would be seen.
 */
const mount = async (
  where: Screen,
  { round = lastRound(), scored = true, served = where === 'online' }: { round?: ReturnType<typeof lastRound>; scored?: boolean; served?: boolean } = {}
) => {
  const Screen = where === 'offline' ? OfflineGameScreen : OnlineGameScreen;
  const view = await renderAppHook(useGameTable, {
    user: { id: 'alice', username: 'Alice' },
    online: served,
    connected: served,
    offline: where === 'offline' ? offlineSave(ENDING, { length: 'match', target: 21, scores: { player_0: 11, player_1: 20, player_2: 6, player_3: 3 } }) : undefined,
    wrap: (probe) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        {probe}
        <Screen />
      </SafeAreaProvider>
    ),
  });
  if (where === 'offline') {
    await advance(DEALT);
    await act(async () => void view.result.current.playCards([LAST_CARD.id]));
    await advance(THROWN);
  }
  if (served) {
    live = view.socket();
    live.reset();
    await live.deliver('game:state', wire(ENDED, 0), () => {});
    if (scored) await live.deliver('game:round_over', round);
  }
  return view;
};
const pressable = (testID: string) => {
  const button = screen.queryByTestId(testID, HIDDEN);
  return button !== null && button.props.accessibilityState?.disabled !== true;
};
const dim = () => getAnimatedStyle(screen.getByTestId('match-dim', HIDDEN)).opacity;
const tap = () =>
  fireEvent(screen.getByTestId('pile-area', HIDDEN), 'startShouldSetResponderCapture', { nativeEvent: { pageX: 0, pageY: 0 } });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(async () => {
  jest.useRealTimers();
  setMotionPreference('system');
  await AsyncStorage.removeItem(SETTINGS_KEY);
});

describe.each<[Screen, string]>([
  ['offline', 'btn-new-match'],
  ['online', 'btn-rivincita'],
])('a match ending %s', (where, againID) => {
  it('stays on the table and settles on the board with the winner and both actions', async () => {
    const view = await mount(where);
    await advance(board - 100);
    expect(screen.queryByTestId('match-winner', HIDDEN)).toBeNull();
    expect(pressable(againID)).toBe(false);

    await advance(settled);
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('match-winner-name', HIDDEN)).toHaveTextContent('Luan');
    expect(screen.getAllByText(t('matchBoard.wins'), HIDDEN).length).toBeGreaterThan(0);
    expect(screen.getByTestId('score-pill-winner-row', HIDDEN)).toHaveTextContent('1');
    expect(dim()).toBeCloseTo(0.6);
    expect(pressable('btn-home')).toBe(true);
    expect(pressable(againID)).toBe(true);
    await view.unmount();
  });

  it('a tap during the ending jumps to the settled board', async () => {
    const view = await mount(where);
    await advance(board - 600);
    expect(pressable(againID)).toBe(false);
    await tap();
    await advance(16);
    expect(pressable(againID)).toBe(true);
    expect(dim()).toBeCloseTo(0.6);
    await view.unmount();
  });

  it('under reduced motion, the board is settled at once', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ motion: 'on' }));
    const view = await mount(where);
    await advance(16);
    expect(pressable(againID)).toBe(true);
    expect(screen.getByTestId('match-winner-name', HIDDEN)).toHaveTextContent('Luan');
    await view.unmount();
  });
});

describe('New match on the board', () => {
  it('starts a new match offline, with no route change', async () => {
    const view = await mount('offline');
    await advance(settled + 100);
    await fireEvent.press(screen.getByTestId('btn-new-match', HIDDEN));
    expect(view.result.current.match).toMatchObject({ over: false, rounds: [] });
    expect(view.result.current.gameState?.roundOver).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('Home leaves the finished table offline', async () => {
    const view = await mount('offline');
    await advance(settled + 100);
    await fireEvent.press(screen.getByTestId('btn-home', HIDDEN));
    expect(view.result.current.gameState).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/');
    await view.unmount();
  });

  it('holds the online board until the placement points arrive', async () => {
    const view = await mount('online', { scored: false });
    await advance(settled + 100);
    expect(screen.queryByTestId('btn-home', HIDDEN)).toBeNull();

    await live.deliver('game:round_over', lastRound());
    await advance(settled + 100);
    expect(pressable('btn-home')).toBe(true);
    await view.unmount();
  });

  it('sends the rematch vote online and shows its count', async () => {
    const view = await mount('online');
    await advance(settled + 100);
    await fireEvent.press(screen.getByTestId('btn-rivincita', HIDDEN));
    expect(live.sentAs('game:rematch_vote')).toHaveLength(1);

    await live.deliver('game:vote_state', { votes: ['alice'], total: 4 });
    expect(screen.getAllByText(t('roundOverOverlay.nextRoundWaiting', { count: 1, total: 4 }), HIDDEN).length).toBe(1);
    expect(pressable('btn-rivincita')).toBe(false);
    await view.unmount();
  });

  it('shows a refused rematch over the board, not under it', async () => {
    const view = await mount('online');
    await advance(settled + 100);
    await live.deliver('game:error', { code: 'REMATCH_DECLINED', message: 'Rematch declined' });
    const toast = screen.getByText(t('server.REMATCH_DECLINED'), HIDDEN);
    let slot = toast.parent;
    while (slot && StyleSheet.flatten(slot.props.style)?.position !== 'absolute') slot = slot.parent;
    expect(StyleSheet.flatten(slot!.props.style).zIndex).toBeGreaterThan(Layer.moment);
    await view.unmount();
  });
});

describe('the viewer rating under the winner', () => {
  const settle = async (where: Screen, round?: ReturnType<typeof lastRound>, served?: boolean) => {
    const view = await mount(where, { round, served });
    await advance(board + settled);
    expect(screen.getByTestId('match-winner-name', HIDDEN)).toHaveTextContent('Luan');
    return view;
  };
  const spoken = () => screen.getByTestId('score-pill-panel', HIDDEN).props.accessibilityLabel as string;

  it('shows the signed delta, the new rating and the provisional count for a ranked match', async () => {
    const view = await settle(
      'online',
      lastRound({
        ratingDeltas: { alice: -8, luan: 14 },
        ratingsAfter: { alice: { rating: 1192, rounds: 3 }, luan: { rating: 1214, rounds: 9 } },
      })
    );
    expect(screen.getByText(t('matchBoard.ratingLabel'), HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('match-rating-delta', HIDDEN)).toHaveTextContent('−8');
    expect(screen.getByTestId('match-rating', HIDDEN)).toHaveTextContent('1192', { exact: false });
    expect(screen.getByText(t('matchBoard.provisional', { n: 2 }), HIDDEN)).toBeTruthy();
    expect(screen.queryByText(t('matchBoard.notRecorded'), HIDDEN)).toBeNull();
    expect(spoken()).toContain(t('matchBoard.ratingSpoken', { delta: '−8', rating: 1192 }));
    await view.unmount();
  });

  it('shows the delta alone, signed, when no rating came with it', async () => {
    const view = await settle('online', lastRound({ ratingDeltas: { alice: 14 } }));
    expect(screen.getByTestId('match-rating', HIDDEN)).toHaveTextContent('+14');
    expect(screen.queryByText(/provvisorio|provisional/i, HIDDEN)).toBeNull();
    await view.unmount();
  });

  it('says when the hand was not recorded, with no delta', async () => {
    const view = await settle('online', lastRound({ recorded: false }));
    expect(screen.getByText(t('matchBoard.notRecorded'), HIDDEN)).toBeTruthy();
    expect(screen.getByText(t('matchBoard.tooManyBots'), HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('match-rating-delta', HIDDEN)).toBeNull();
    expect(spoken()).toContain(t('matchBoard.notRecordedSpoken'));
    await view.unmount();
  });

  it('says nothing about a match the server closed unscored', async () => {
    const view = await settle('online', lastRound({ recorded: false, matchContinues: false }));
    expect(screen.queryByText(t('matchBoard.notRecorded'), HIDDEN)).toBeNull();
    await view.unmount();
  });

  it.each([
    ['a rated', lastRound({ ratingDeltas: { alice: 14 } })],
    ['an unrecorded', lastRound({ recorded: false })],
  ])('shows neither on an offline table, with %s online round standing', async (_, round) => {
    const view = await settle('offline', round, true);
    expect(screen.queryByTestId('match-rating', HIDDEN)).toBeNull();
    expect(screen.queryByText(t('matchBoard.notRecorded'), HIDDEN)).toBeNull();
    await view.unmount();
  });
});
