// tests/native/roundMarathon.test.tsx — one table, round after round on its own clocks: every deal and exchange gate opens (#1624).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/errorReporting', () => ({
  ...jest.requireActual<object>('@/lib/errorReporting'),
  __esModule: true,
  reportError: jest.fn(() => true),
}));

import { GameTable, type ExchangeAnnouncementSlot } from '@/components/GameTable';
import { reportError } from '@/lib/errorReporting';
import { GATE_WATCHDOG_MS } from '@/lib/game/gateWatchdog';
import { emptyRankTally, type Card, type GameState, type Player, type Rank, type Suit } from '@/lib/game/gameEngine';
import type { ExchangeAnnounceData } from '@/lib/game/sharedGameFlow';
import { en } from '@/locales/en';
import { bootFeedback } from './helpers/feedback';

const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const seat = (id: string, name: string, hand: Card[], type: Player['type']): Player => ({ id, name, hand, type });
const NAMES = ['Ana', 'Bea', 'Cesk'];

const players = (hands: Card[][]) => hands.map((hand, i) => seat(`player_${i}`, NAMES[i], hand, i === 0 ? 'human' : 'bot'));
const HANDS = [
  [card('5', 'hearts'), card('9', 'clubs'), card('K', 'diamonds'), card('A', 'spades')],
  [card('4', 'clubs'), card('7', 'hearts'), card('J', 'spades')],
  [card('6', 'hearts'), card('8', 'diamonds'), card('Q', 'clubs')],
];

const base = (currentTurnIndex: number, hands = HANDS): GameState => ({
  players: players(hands),
  currentTurnIndex,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  playedRanks: emptyRankTally(),
});
const ended = (finishingOrder: string[]): GameState => ({ ...base(0), roundOver: true, finishingOrder });

interface Round {
  name: string;
  /** The round as dealt, its exchange open. */
  dealt: GameState;
  announced: ExchangeAnnounceData;
  /** The card the winner gives once the choice opens; none for both Jokers. */
  given?: Card;
  onMove: number;
}

const ROUNDS: Round[] = [
  {
    name: 'the viewer won and gives back',
    dealt: {
      ...base(0),
      exchangePhase: { active: true, winnerIdx: 0, loserIdx: 2, cardFromLoser: card('2', 'spades'), twoJokerException: false },
    },
    announced: { winnerName: 'Ana', loserName: 'Cesk', winnerIdx: 0, loserIdx: 2, twoJokerException: false, cardReceived: card('2', 'spades') },
    given: card('5', 'hearts'),
    onMove: 2,
  },
  {
    name: 'the loser holds both Jokers',
    dealt: base(1),
    announced: { winnerName: 'Bea', loserName: 'Ana', winnerIdx: 1, loserIdx: 0, twoJokerException: true },
    onMove: 0,
  },
  {
    name: 'the viewer placed last and pays',
    dealt: {
      ...base(1),
      exchangePhase: { active: true, winnerIdx: 1, loserIdx: 0, cardFromLoser: card('A', 'spades'), twoJokerException: false },
    },
    announced: { winnerName: 'Bea', loserName: 'Ana', winnerIdx: 1, loserIdx: 0, twoJokerException: false, cardReceived: card('A', 'spades') },
    given: card('4', 'clubs'),
    onMove: 1,
  },
];
const ENDINGS = [
  ['player_0', 'player_1', 'player_2'],
  ['player_1', 'player_2', 'player_0'],
  ['player_1', 'player_2', 'player_0'],
];

const HIDDEN_TOO = { includeHiddenElements: true };
const STEP_MS = 100;
const chipReads = (seatOnMove: number) =>
  within(screen.getByTestId('game-hud-stack')).queryByText(
    seatOnMove === 0 ? en['gameShared.yourTurn'] : en['gameShared.turnOf'].replace('{{name}}', NAMES[seatOnMove]),
    HIDDEN_TOO
  ) !== null;

/** Frame by frame until `done` holds, inside the gate watchdog: a healthy run never waits it out. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let t = 0; !done(); t += STEP_MS) {
    if (t > GATE_WATCHDOG_MS - 1000) throw new Error(`${what}: not within ${t} ms`);
    await act(async () => jest.advanceTimersByTime(STEP_MS));
  }
}

describe('a table played round after round', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.mocked(reportError).mockClear();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('deals, exchanges and hands the turn on, every round, with no watchdog', async () => {
    const onDealing = jest.fn<(dealing: boolean) => void>();
    const onExchangeReady = jest.fn();
    const onDismiss = jest.fn();
    const table = (gameState: GameState, exchangeAnnouncement?: ExchangeAnnouncementSlot) => (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
        <GameTable
          gameState={gameState}
          viewerSeat={0}
          onPlay={() => {}}
          onPass={() => {}}
          onQuit={() => {}}
          onExchangeGive={() => {}}
          onExchangeReady={onExchangeReady}
          onDealing={onDealing}
          exchangeAnnouncement={exchangeAnnouncement}
        />
      </SafeAreaProvider>
    );
    const view = await render(table(ended(ENDINGS[0])));
    await until(() => onDealing.mock.calls.length > 0, 'the standing table');

    for (const [i, r] of ROUNDS.entries()) {
      if (i > 0) await view.rerender(table(ended(ENDINGS[i])));
      await until(() => onDealing.mock.calls.at(-1)?.[0] === false, `${r.name}: the last round settled`);
      const counts = { dealt: onDealing.mock.calls.length, ready: onExchangeReady.mock.calls.length, dismissed: onDismiss.mock.calls.length };
      const slot = (data: ExchangeAnnounceData): ExchangeAnnouncementSlot => ({ visible: true, data, onDismiss });

      await view.rerender(table(r.dealt, slot(r.announced)));
      await until(() => onDealing.mock.calls.slice(counts.dealt).some(([d]) => d), `${r.name}: the deal starts`);
      await until(() => onDealing.mock.calls.at(-1)?.[0] === false, `${r.name}: the deal lands`);
      if (r.given) {
        await until(() => onExchangeReady.mock.calls.length > counts.ready, `${r.name}: the choice opens`);
        const after = { ...r.dealt, exchangePhase: undefined };
        await view.rerender(table(after, slot({ ...r.announced, cardGiven: r.given })));
      }
      await until(() => onDismiss.mock.calls.length > counts.dismissed, `${r.name}: the ceremony closes`);
      await view.rerender(table({ ...r.dealt, currentTurnIndex: r.onMove, exchangePhase: undefined }));
      await until(() => chipReads(r.onMove), `${r.name}: the turn reaches seat ${r.onMove}`);

      expect({
        round: r.name,
        dealing: onDealing.mock.calls.at(-1),
        ready: onExchangeReady.mock.calls.length - counts.ready,
        dismissed: onDismiss.mock.calls.length - counts.dismissed,
      }).toEqual({ round: r.name, dealing: [false], ready: r.given ? 1 : 0, dismissed: 1 });
    }
    expect(jest.mocked(reportError)).not.toHaveBeenCalled();
    await view.unmount();
  }, 90_000);
});
