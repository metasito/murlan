import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import { TurnChip } from '@/components/table/turnChip';
import { CLOCK_RUNNING_OUT_SECONDS } from '@/components/turnTimerUi';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import { MOMENTS, type MomentKind } from '@/lib/device/moments';
import { choiceOpensAt } from '@/lib/game/exchangeTimeline';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { bootFeedback, settle, sounds } from './helpers/feedback';
import { botManche, playBotManche } from './helpers/botManche';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};
const SEVEN_H: Card = { id: '7_hearts', rank: '7', suit: 'hearts', isJoker: false };
const FIVE_H: Card = { id: '5_hearts', rank: '5', suit: 'hearts', isJoker: false };
const TWO_S: Card = { id: '2_spades', rank: '2', suit: 'spades', isJoker: false };
const seat = (id: string, hand: Card[]): Player => ({ id, name: id, hand, type: 'human' });
type Extra = { handScores?: Record<string, number>; matchOver?: boolean; matchWinners?: string[]; selectedIds?: string[] };

const human = (turn: number, exchange = false): GameState => ({
  players: [seat('player_0', [SEVEN_H, FIVE_H]), seat('player_1', [TWO_S])],
  currentTurnIndex: turn,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  ...(exchange ? { exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: TWO_S, bothJokersException: false } } : {}),
});

const table = (s: GameState, x: Extra = {}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={s} viewerSeat={0} selectedIds={[]} onSelectCard={noop} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} handScores={{}} {...x} />
  </SafeAreaProvider>
);

const heardIds = (from = 0) => sounds().slice(from).flatMap((s) => (s ? [s] : []));
const press = async (node: Parameters<typeof fireEvent.press>[0]) => act(async () => { fireEvent.press(node); });
const seven = () => screen.getAllByLabelText(cardSpokenName(SEVEN_H, t))[0];

async function heard(mount: React.ReactElement, action: (r: Awaited<ReturnType<typeof render>>) => Promise<void>): Promise<string[]> {
  const r = await render(mount);
  await settle(2000);
  const before = sounds().length;
  await action(r);
  await settle(2000);
  const out = heardIds(before);
  await r.unmount();
  return out;
}

async function wholeManche(): Promise<string[]> {
  const r = await playBotManche(table);
  const out = heardIds();
  await r.unmount();
  return out;
}

async function mancheEnd(x: (last: GameState) => Extra): Promise<string[]> {
  const states = botManche();
  const last = states[states.length - 1];
  const scores = Object.fromEntries(last.rankings.map((id, i) => [id, i]));
  return heard(table(states[states.length - 2]), async (r) => {
    await act(async () => r.rerender(table(last, { handScores: scores, ...x(last) })));
  });
}

let manche: Promise<string[]> | undefined;
const botSounds = () => (manche ??= wholeManche());

const PROBES: Record<MomentKind, { sounds: string[]; run: () => Promise<string[]> }> = {
  landing: { sounds: ['play', 'combo', 'bomb'], run: botSounds },
  pass: { sounds: ['pass'], run: botSounds },
  roundWon: { sounds: ['round_win'], run: botSounds },
  roundStart: { sounds: ['round_start'], run: botSounds },
  deal: { sounds: ['deal'], run: botSounds },
  turn: { sounds: ['turn'], run: () => heard(table(human(1)), async (r) => { await act(async () => r.rerender(table(human(0)))); }) },
  select: { sounds: ['select'], run: () => heard(table(human(0)), () => press(seven())) },
  deselect: { sounds: ['deselect'], run: () => heard(table(human(0), { selectedIds: [SEVEN_H.id] }), () => press(seven())) },
  reject: { sounds: ['reject'], run: () => heard(table(human(0)), () => press(screen.getByTestId('btn-gioca'))) },
  give: { sounds: ['play'], run: () => heard(table(human(0, true)), async () => { await settle(choiceOpensAt(false)); await press(seven()); await press(screen.getByTestId('btn-gioca')); }) },
  exchange: { sounds: ['exchange'], run: () => heard(table(human(0)), async (r) => { await act(async () => r.rerender(table(human(0, true)))); }) },
  mancheOver: { sounds: ['mancheWon', 'mancheLost', 'mancheNeutral'], run: () => mancheEnd(() => ({})) },
  partitaOver: { sounds: ['partitaWon', 'partitaLost'], run: () => mancheEnd((last) => ({ matchOver: true, matchWinners: [last.rankings[0]] })) },
  clockRunningOut: {
    sounds: ['clockRunningOut'],
    run: () => heard(<TurnChip seconds={CLOCK_RUNNING_OUT_SECONDS + 3} active resetKey="t" scale={1} lit chipText="" spokenSeat="" />, () => settle(2000)),
  },
};

describe('every moment the policy knows is raised by a real caller', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('has one probe per moment kind, and no other', () => {
    expect(Object.keys(PROBES).sort()).toEqual(Object.keys(MOMENTS).sort());
  });

  it.each(Object.keys(PROBES) as MomentKind[])('%s', async (kind) => {
    const { sounds: expected, run } = PROBES[kind];
    const got = await run();
    expect(got.some((s) => expected.includes(s))).toBe(true);
  }, 60_000);
});
