// tests/native/oneWayExchange.test.tsx — a one-way exchange is told through the table's two pills (#1833).
//
// The winner holds nothing from 3 to 10 to give back, so the deal settled the exchange: only the
// receive plays, and the second step is said by the last-played pill and the turn pill, which carry
// the two-way exchange's words too. Nothing is drawn on the felt for either.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import { exchangeAnnouncementOf } from '@/lib/game/sharedGameFlow';
import { choiceOpensAt, LEG, oneWayEndsAt } from '@/lib/timeline/exchangeTimeline';
import { emptyRankTally } from '@/lib/game/gameEngine';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';
import { dealEndMs } from '@/lib/timeline/dealTimeline';
import { Motion } from '@/lib/tokens';
import { activate } from './tapHelpers';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const seat = (id: string, name: string, hand: Card[]): Player => ({ id, name, hand, type: 'human' });

const TAKEN = card('2', 'spades');
const LEAD = card('4', 'clubs');
const WINNER = 'Ana';
const LOSER = 'Bea';
const BYSTANDER = 'Cesk';

/** Ana holds nothing from 3 to 10 once she has the 2; Bea, who lost the round, leads. */
const oneWay = (): GameState => ({
  players: [
    seat('player_0', WINNER, [card('J', 'clubs'), card('K', 'diamonds'), card('A', 'spades'), TAKEN]),
    seat('player_1', LOSER, [LEAD, card('6', 'clubs')]),
    seat('player_2', BYSTANDER, [card('6', 'hearts')]),
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: emptyRankTally(),
  lastMove: { seq: 0, kind: 'deal' },
  startReason: { type: 'lost_round', playerIdx: 1 },
  exchangePhase: { kind: 'settled', winnerIdx: 0, loserIdx: 1, cardFromLoser: TAKEN },
});

const twoWay = (): GameState => ({
  ...oneWay(),
  currentTurnIndex: 0,
  startReason: { type: 'lost_round', playerIdx: 1 },
  exchangePhase: { kind: 'open', winnerIdx: 0, loserIdx: 1, cardFromLoser: TAKEN },
});

const counts = (s: GameState) => s.players.map((p) => p.hand.length);
const DEAL_END = dealEndMs(counts(oneWay()), Motion.duration.reveal);
const noop = () => {};

const table = (s: GameState, opts: { viewerSeat: number; visible?: boolean; onDismiss?: () => void; onPlay?: (ids: string[]) => void }) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={s}
      viewerSeat={opts.viewerSeat}
      onPlay={opts.onPlay ?? noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      exchangeAnnouncement={
        opts.visible === false
          ? undefined
          : { visible: true, data: exchangeAnnouncementOf(null, s), onDismiss: opts.onDismiss ?? noop }
      }
    />
  </SafeAreaProvider>
);

const step = async (ms: number) => {
  for (let at = 0; at < ms; at += 16) await act(async () => jest.advanceTimersByTime(16));
};
const words = (testID: string, line: string) =>
  within(screen.getByTestId(testID, { includeHiddenElements: true })).queryAllByText(line, { includeHiddenElements: true }).length;
const comboPill = (line: string) => words('notice-hudCombo', line);
const turnPill = (line: string) => words('game-hud-stack', line);

describe('a one-way exchange on the table', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('draws the receive, with the card said on the last-played pill and nothing tagged on the pile', async () => {
    const r = await render(table(oneWay(), { viewerSeat: 2 }));
    await step(DEAL_END + Motion.exchange.beat + LEG.rest + 96);
    expect(comboPill(t('exchange.pileGives', { from: LOSER, card: '2♠', to: WINNER }))).toBeGreaterThan(0);
    expect(screen.queryByTestId('exchange-pile-label')).toBeNull();
    expect(screen.queryByTestId('notice-pileLabel')).toBeNull();
    expect(turnPill(t('exchange.chipTitle'))).toBeGreaterThan(0);
    await r.unmount();
  });

  it.each([
    ['the winner', 0, t('exchange.chipOneWayYou')],
    ['the loser', 1, t('exchange.chipOneWay', { name: WINNER })],
    ['a seat outside the exchange', 2, t('exchange.chipOneWay', { name: WINNER })],
  ])('says to %s that the winner has nothing to give back, on both pills, once the receive is read', async (_who, viewerSeat, chip) => {
    const line = t('exchange.pillNothing');
    const r = await render(table(oneWay(), { viewerSeat }));
    await step(DEAL_END + choiceOpensAt(false) - 96);
    expect(comboPill(line)).toBe(0);
    expect(turnPill(chip)).toBe(0);
    await step(192);
    expect(comboPill(line)).toBeGreaterThan(0);
    expect(turnPill(chip)).toBeGreaterThan(0);
    await r.unmount();
  });

  it('ends its ceremony on the beat after, and not before', async () => {
    const onDismiss = jest.fn();
    const r = await render(table(oneWay(), { viewerSeat: 2, onDismiss }));
    await step(DEAL_END + oneWayEndsAt(false) - 160);
    expect(onDismiss).not.toHaveBeenCalled();
    await step(320);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await r.unmount();
  });

  it("holds the loser's first play behind the ceremony, and lets it through once the ceremony is over", async () => {
    const lead = async (visible: boolean, wait: number) => {
      const onPlay = jest.fn<(ids: string[]) => void>();
      const r = await render(table(oneWay(), { viewerSeat: 1, onPlay, visible }));
      await step(wait);
      // Without a ceremony the who-starts gate holds the table first; one tap clears it.
      if (!visible) await act(async () => fireEvent.press(screen.getByTestId('start-reason-gate', { includeHiddenElements: true })));
      await step(64);
      await activate(screen.getAllByLabelText(cardSpokenName(LEAD, t))[0]);
      await act(async () => fireEvent.press(screen.getByTestId('btn-gioca')));
      await r.unmount();
      return onPlay;
    };
    expect(await lead(false, DEAL_END + 96)).toHaveBeenCalledWith([LEAD.id]);
    expect(await lead(true, DEAL_END + oneWayEndsAt(false) - 160)).not.toHaveBeenCalled();
  });

  it("says why the loser leads in the who-starts panel's sub-line, for a table that rejoins or restores", async () => {
    const r = await render(table(oneWay(), { viewerSeat: 2, visible: false }));
    await step(DEAL_END + 96);
    expect(words('notice-whoStarts', t('gameShared.startReasonOneWaySub', { name: WINNER }))).toBeGreaterThan(0);
    await r.unmount();
  });

  it('says it to the winner in the second person', async () => {
    const r = await render(table(oneWay(), { viewerSeat: 0, visible: false }));
    await step(DEAL_END + 96);
    expect(words('notice-whoStarts', t('gameShared.startReasonOneWaySubYou'))).toBeGreaterThan(0);
    await r.unmount();
  });
});

describe('a two-way exchange on the same pills', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('says who gives what to whom on the last-played pill, and not on the pile', async () => {
    const s = twoWay();
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={s} viewerSeat={2} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SafeAreaProvider>
    );
    await step(dealEndMs(counts(s), Motion.duration.reveal) + Motion.exchange.beat + LEG.rest + 96);
    expect(comboPill(t('exchange.pileGives', { from: LOSER, card: '2♠', to: WINNER }))).toBeGreaterThan(0);
    expect(screen.queryByTestId('exchange-pile-label')).toBeNull();
    await r.unmount();
  });
});
