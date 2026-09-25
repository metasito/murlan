// tests/native/scorePill.test.tsx — the score pill is one button naming your points and place,
// opens into the standings on a tap, and never costs a play (#1265).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

jest.mock('@/lib/device/sounds', () => ({
  ensureAudioMode: jest.fn(async () => {}),
  playCardSelect: jest.fn(async () => {}),
  playCardDeselect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCombo: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playClockRunningOut: jest.fn(async () => {}),
  stopClockRunningOut: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playMancheWon: jest.fn(async () => {}),
  playMancheLost: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  holdSounds: jest.fn(() => () => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'on',
}));

import { GameTable } from '@/components/GameTable';
import { cardSpokenName } from '@/lib/cardNames';
import { t, tn } from '@/lib/i18n';
import { motionMs } from '@/lib/tokens';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const NAMES = ['Ana', 'Besi', 'Cimi', 'Drin'];
const TEAMS = ['A', 'B', 'A', 'B'] as const;
const SEVEN: Card = { id: 'h7', rank: '7', suit: 'hearts', isJoker: false } as Card;
const handOf = (seat: number): Card[] =>
  seat === 0 ? [SEVEN] : [{ id: `s${seat}`, rank: '3', suit: 'spades', isJoker: false } as Card];

const state = (teams: boolean): GameState => ({
  players: NAMES.map(
    (name, i): Player => ({ id: `player_${i}`, name, hand: handOf(i), type: 'human', ...(teams && { team: TEAMS[i] }) })
  ),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: teams ? 'teams' : 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const SCORES = { player_0: 7, player_1: 12, player_2: 9, player_3: 3 };

const noop = () => {};
const table = (opts: { teams?: boolean; onSelectCard?: (id: string) => void; partita?: boolean } = {}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={state(opts.teams ?? false)}
      matchScore={opts.partita === false ? undefined : { scores: SCORES, target: 21 }}
      viewerSeat={0}
      selectedIds={[]}
      onSelectCard={opts.onSelectCard ?? noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const FRAME_MS = 16;
const pill = () => screen.getByTestId('score-pill');
const press = async (node: ReturnType<typeof screen.getByTestId>) => {
  await fireEvent.press(node);
  await act(async () => {
    jest.advanceTimersByTime(motionMs('shift', true) + FRAME_MS);
  });
};
const row = (place: number, name: string, points: number) => tn('scorePill.a11yRow', points, { place, name });
const standingsSaying = (rows: string[]) => [t('scorePill.standings'), ...rows].join(' ');
// RNTL judges hiddenness by the mount-time style; the panel's `display` is animated, so read it live.
const shownStandings = (label: string) => {
  const panels = screen.getAllByLabelText(label, { includeHiddenElements: true });
  expect(panels).toHaveLength(1);
  expect(getAnimatedStyle(panels[0]).display).toBe('flex');
  return panels[0];
};

describe('the score pill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is one button naming your points and place, closed', async () => {
    const r = await render(table());
    expect(pill().props.accessibilityLabel).toBe(tn('scorePill.a11yLabel', 7, { target: 21, place: 3 }));
    expect(pill().props.accessibilityRole).toBe('button');
    expect(pill().props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    expect(screen.queryByLabelText(new RegExp(`^${t('scorePill.standings')} `))).toBeNull();
    await r.unmount();
  });

  it('opens on a tap into the standings, best first, and closes on the next', async () => {
    const r = await render(table());
    await press(pill());
    expect(pill().props.accessibilityState).toEqual(expect.objectContaining({ expanded: true }));
    const you = t('scorePill.you');
    const panel = shownStandings(
      standingsSaying([row(1, 'Besi', 12), row(2, 'Cimi', 9), row(3, you, 7), row(4, 'Drin', 3)])
    );
    await press(pill());
    expect(pill().props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    expect(getAnimatedStyle(panel).display).toBe('none');
    await r.unmount();
  });

  it('reads one row per pair in teams mode, partners summed', async () => {
    const r = await render(table({ teams: true }));
    expect(pill().props.accessibilityLabel).toBe(tn('scorePill.a11yLabel', 16, { target: 21, place: 1 }));
    await press(pill());
    const team = (x: string) => t('lobby.team', { team: x });
    shownStandings(standingsSaying([row(1, team('A'), 16), row(2, team('B'), 15)]));
    await r.unmount();
  });

  it('leaves the hand pressable while open, and a touch elsewhere closes it', async () => {
    const onSelectCard = jest.fn<(id: string) => void>();
    const r = await render(table({ onSelectCard }));
    await press(pill());
    const card = () => screen.getByLabelText(cardSpokenName(SEVEN, t));
    await press(card());
    expect(onSelectCard).toHaveBeenCalledWith(SEVEN.id);
    let tableRoot = null;
    for (let n = card().parent; n; n = n.parent) if (n.props.onStartShouldSetResponderCapture) tableRoot = n;
    await act(async () => {
      tableRoot!.props.onStartShouldSetResponderCapture({ nativeEvent: { pageX: 400, pageY: 340 } });
    });
    expect(pill().props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    await r.unmount();
  });

  it('is absent where there is no partita', async () => {
    const r = await render(table({ partita: false }));
    expect(screen.queryByTestId('score-pill')).toBeNull();
    await r.unmount();
  });
});
