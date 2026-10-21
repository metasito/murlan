// tests/native/onlineRoundEndsOnTable.test.tsx — online, a round ends on the table: no results
// overlay, the score pill holds open with the next-round vote at its foot, and the next deal closes it.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as particles from '@/components/table/particles';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setMotionPreference } from '@/lib/accessibility';
import { SETTINGS_KEY } from '@/lib/storageKeys';
import type { GameState, Player } from '@/lib/game/gameEngine';
import { roundEndingOnsets } from '@/lib/timeline/roundEnding';
import { t } from '@/lib/i18n';
import { aThreePlayed, state } from '../support/game';
import { renderApp } from './harness/renderApp';
import { roundOver, wire } from './harness/wire';

const seat = (i: number): Player => ({ id: `player_${i}`, name: `P${i}`, hand: [], type: i === 0 ? 'human' : 'bot' });
const ENDED: GameState = state({
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: true,
  finishingOrder: ['player_0', 'player_1', 'player_2', 'player_3'],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
});
const DEALT: GameState = state({ ...ENDED, roundOver: false, finishingOrder: [], openingCard: null });
const POINTS = { player_0: 3, player_1: 1, player_2: 0, player_3: 0 };
const TOTALS = { player_0: 10, player_1: 4, player_2: 2, player_3: 1 };

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() } }));
const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const HIDDEN = { includeHiddenElements: true };
const { close, settled } = roundEndingOnsets(4);
const screenNow = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const pillOpen = () => getAnimatedStyle(screen.getByTestId('score-pill-panel', HIDDEN)).display === 'flex';
const voteShown = () => getAnimatedStyle(screen.getByTestId('round-vote', HIDDEN)).display === 'flex';
const voteButton = () => screen.queryByRole('button', { name: t('roundOverOverlay.nextRoundA11yLabel'), ...HIDDEN });
const overlayLeave = () => screen.queryByTestId('btn-home', HIDDEN);

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(async () => {
  jest.useRealTimers();
  setMotionPreference('system');
  await AsyncStorage.removeItem(SETTINGS_KEY);
});

type View = Awaited<ReturnType<typeof renderApp>>;
const sends = (view: View, next: GameState) => view.socket().deliver('game:state', wire(next, 0), () => {});
const scores = (view: View, ended: GameState, points: Record<string, number>) =>
  view.socket().deliver('game:round_over', roundOver(ended, points, { totals: TOTALS }));

/** Alice's table at `ended`, scored with `points` unless the score has not arrived yet. */
const mount = async (ui: React.ReactElement, { ended = ENDED, points = POINTS as Record<string, number> | null } = {}) => {
  const view = await renderApp(ui, { user: { id: 'alice', username: 'Alice' }, online: true, connected: true });
  await sends(view, ended);
  if (points) await scores(view, ended, points);
  view.socket().reset();
  return view;
};

describe('a round ending online', () => {
  it('holds the pill open with the vote at its foot, no overlay, until the next deal', async () => {
    const view = await mount(screenNow());
    await advance(close + settled);
    expect(overlayLeave()).toBeNull();
    expect(pillOpen()).toBe(true);
    expect(voteShown()).toBe(true);
    expect(within(screen.getByTestId('round-vote', HIDDEN)).getAllByText('0/4', HIDDEN).length).toBe(1);

    await fireEvent.press(voteButton()!);
    expect(view.socket().sentAs('game:rematch_vote')).toHaveLength(1);

    await view.socket().deliver('game:vote_state', { votes: ['alice'], total: 4 });
    expect(screen.getAllByText(t('roundOverOverlay.nextRoundWaiting', { count: 1, total: 4 }), HIDDEN).length).toBeGreaterThan(0);
    expect(pillOpen()).toBe(true);

    await sends(view, DEALT);
    await advance(settled);
    expect(pillOpen()).toBe(false);
    expect(screen.queryByTestId('round-vote', HIDDEN)).toBeNull();
    await view.unmount();
  });

  it('under reduced motion, the next deal closes the held pill at once', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ motion: 'on' }));
    const view = await mount(screenNow());
    await advance(close + settled);
    expect(pillOpen()).toBe(true);

    await sends(view, DEALT);
    await advance(16);
    expect(pillOpen()).toBe(false);
    await view.unmount();
  });

  it("waits for this round's placement points before the pill opens", async () => {
    const view = await mount(screenNow(), { points: null });
    await advance(close + settled);
    expect(overlayLeave()).toBeNull();
    expect(pillOpen()).toBe(false);

    await scores(view, ENDED, POINTS);
    await advance(close);
    expect(pillOpen()).toBe(true);
    await view.unmount();
  });

  it("decides a teams round's outcome on its own placement points, never the last round's", async () => {
    const teamOf = (i: number) => (i === 0 || i === 3 ? 'A' : 'B');
    const teamsEnded: GameState = {
      ...ENDED,
      gameMode: 'teams',
      players: [0, 1, 2, 3].map((i) => ({ ...seat(i), team: teamOf(i) })),
      finishingOrder: ['player_0', 'player_3', 'player_1', 'player_2'],
    };
    const motes = jest.spyOn(particles, 'roundMotes');
    // The last round's points stay with the match while the next round is dealt and played out.
    const view = await mount(screenNow(), { ended: teamsEnded, points: { player_0: 2, player_3: 1, player_1: 2, player_2: 1 } });
    await sends(view, { ...teamsEnded, roundOver: false, finishingOrder: [], openingCard: null });
    await sends(view, teamsEnded);
    motes.mockClear();
    await advance(close + settled);
    expect(motes).not.toHaveBeenCalled();

    await scores(view, teamsEnded, { player_0: 3, player_3: 2, player_1: 1, player_2: 0 });
    await advance(close + settled);
    expect(motes.mock.calls.map(([outcome]) => outcome)).toEqual(['won']);
    motes.mockRestore();
    await view.unmount();
  });
});
