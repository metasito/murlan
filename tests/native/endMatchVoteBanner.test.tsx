// tests/native/endMatchVoteBanner.test.tsx — the end-match vote banner
// (#896): a stray tap must not end the match unscored, the accessible name
// must say what the control does rather than repeat its own hint, and the
// live tally must land on a node of its own rather than inside the control.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { NoticePalette } from '@/lib/theme';

import { en as locale } from '@/locales/en';
import { aThreePlayed, state } from '../support/game';
import { renderApp } from './harness/renderApp';
import { wire } from './harness/wire';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const seat = (id: string, name: string, extra: Partial<Player> = {}): Player => ({
  id,
  name,
  hand: [] as Card[],
  type: 'human',
  ...extra,
});

const stateWith = (over: Partial<GameState>): GameState => state({
  players: [
    seat('player_0', 'Alice'),
    seat('player_1', 'Drita', { type: 'bot', vacated: true } as Partial<Player>),
    seat('player_2', 'Carl'),
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
  ...over,
});

// The felt, seats and animation live in <GameTable> and need real gesture and
// audio modules this test has no business loading — everything this file
// cares about (the banner, the confirm dialog) is passed to it as props.
jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  const { EndMatchVote } = require('@/components/table/notices/netNotes') as typeof import('@/components/table/notices/netNotes');
  return {
    GameTable: (props: {
      endMatchVote?: import('@/components/table/notices/netNotes').EndMatchVoteNote | null;
      overlays?: (v: object) => React.ReactNode;
    }) =>
      react.createElement(rn.View, null, [
        props.endMatchVote ? react.createElement(EndMatchVote, { key: 'vote', ...props.endMatchVote, scale: 1 }) : null,
        react.createElement(rn.View, { key: 'overlays' }, props.overlays ? props.overlays({}) : null),
      ]),
  };
});

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType })
  .default;

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const screenUnderTest = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);

type Tally = { votes: string[]; total: number };

/** Alice at a table with Drita's seat vacated, the end-match tally at `tally` if one was sent. */
const mount = async (ui: React.ReactElement, tally: Tally | null = null) => {
  const view = await renderApp(ui, { user: { id: 'alice', username: 'Alice' }, online: true, connected: true });
  await view.socket().deliver('game:state', wire(stateWith({}), 0), () => {});
  if (tally) await view.socket().deliver('game:end_match_vote_state', tally);
  view.socket().reset();
  return view;
};

const votes = (view: Awaited<ReturnType<typeof mount>>) =>
  view.socket().sentAs('game:end_match_vote').map((v) => v.wants);

describe('the end-match vote banner, a seat vacated', () => {
  it('names what tapping it does, not its own hint, before anyone has voted', async () => {
    const view = await mount(screenUnderTest());

    const button = view.getByRole('button', { name: locale['game.endMatchVoteButton'] });
    expect(button).toBeTruthy();

    await view.unmount();
  });

  it('opens a confirmation and emits nothing until the accept control is pressed', async () => {
    const view = await mount(screenUnderTest());

    await fireEvent.press(view.getByRole('button', { name: locale['game.endMatchVoteButton'] }));
    expect(votes(view)).toEqual([]);

    const accept = await waitFor(() => view.getByTestId('confirm-accept'));
    await fireEvent.press(accept);
    expect(votes(view)).toEqual([true]);

    await view.unmount();
  });

  it('reads as the withdraw control once the tally shows the viewer has voted', async () => {
    const view = await mount(screenUnderTest(), { votes: ['alice'], total: 2 });

    const button = view.getByRole('button', { name: locale['game.endMatchWithdrawButton'] });
    expect(button).toBeTruthy();
    expect(
      view.queryByRole('button', { name: locale['game.endMatchVoteButton'] })
    ).toBeNull();

    await fireEvent.press(button);
    expect(votes(view)).toEqual([false]);

    await view.unmount();
  });

  it('puts the live tally on a node of its own, apart from the button', async () => {
    const view = await mount(screenUnderTest(), { votes: ['alice'], total: 2 });

    const tallyText = locale['game.endMatchVoteTallyVoted']
      .replace('{{votes}}', '1')
      .replace('{{total}}', '2');
    const button = view.getByRole('button', { name: locale['game.endMatchWithdrawButton'] });
    // G2's count shape: the sentence is the live region's alone, outside the
    // control, so it is announced as it changes; the plate shows the count.
    expect(view.getAllByText(tallyText, { includeHiddenElements: true })).toHaveLength(1);
    expect(within(button).queryAllByText(tallyText, { includeHiddenElements: true })).toHaveLength(0);
    expect(within(button).getByText('1/2', { includeHiddenElements: true })).toBeTruthy();

    await view.unmount();
  });

  it('is one notice plate, lit once the viewer has voted, so a second tap visibly withdraws', async () => {
    const edge = (view: Awaited<ReturnType<typeof mount>>) =>
      StyleSheet.flatten(view.getByTestId('notice-endMatchVote', { includeHiddenElements: true }).props.style).borderColor;
    const idle = await mount(screenUnderTest());
    expect(edge(idle)).toBe(NoticePalette.pill.neutral.edge);
    await idle.unmount();

    const voted = await mount(screenUnderTest(), { votes: ['alice'], total: 2 });
    expect(edge(voted)).toBe(NoticePalette.pill.lit.edge);
    expect(voted.getAllByTestId('notice-endMatchVote', { includeHiddenElements: true })).toHaveLength(1);
    await voted.unmount();
  });

  it('reverts to the base label once the tally returns to zero (a withdrawal)', async () => {
    const view = await mount(screenUnderTest(), { votes: [], total: 2 });

    expect(
      view.getByText(locale['game.endMatchVoteButton'], { includeHiddenElements: true })
    ).toBeTruthy();
    expect(view.getByRole('button', { name: locale['game.endMatchVoteButton'] })).toBeTruthy();
    expect(view.queryByRole('button', { name: locale['game.endMatchWithdrawButton'] })).toBeNull();

    await view.unmount();
  });
});
