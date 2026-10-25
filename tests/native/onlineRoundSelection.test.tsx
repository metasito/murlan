// tests/native/onlineRoundSelection.test.tsx — the online screen holds no selection; the table's
// own keeps what the server's answer leaves in the hand and drops the rest at the deal.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { activate } from './tapHelpers';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';
import { aThreePlayed, state } from '../support/game';
import { renderApp } from './harness/renderApp';
import { room, wire } from './harness/wire';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

const KING = card('K', 'hearts');
const NINE = card('9', 'spades');
const FOUR = card('4', 'diamonds');

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const stateWith = (hand: Card[], over: Partial<GameState> = {}): GameState => state({
  players: [seat('player_0', 'Ana', hand), seat('player_1', 'Besi', [card('4', 'clubs')])],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
  ...over,
});

import OnlineGameScreen from '@/app/(online)/game';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const screenUnderTest = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);

const cardNode = (c: Card) => screen.getByLabelText(cardSpokenName(c, t));
const selected = (c: Card) => cardNode(c).props.accessibilityState?.selected === true;
const tap = async (c: Card) => {
  await act(async () => {
    await activate(cardNode(c));
  });
};
const serverSends = (r: Awaited<ReturnType<typeof mount>>, next: GameState) =>
  r.socket().deliver('game:state', wire(next, 0), () => {});

const mount = async (ui: React.ReactElement) => {
  const r = await renderApp(ui, { user: { id: 'u1', username: 'Ana' }, online: true, connected: true });
  await serverSends(r, stateWith([KING, NINE]));
  r.socket().reset();
  return r;
};

describe('the online table selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is cleared by the deal, even one that deals the staged card back', async () => {
    const r = await mount(screenUnderTest());
    await tap(KING);
    expect(selected(KING)).toBe(true);

    await serverSends(r, stateWith([KING, NINE], { roundOver: true, finishingOrder: ['player_1'] }));
    expect(selected(KING)).toBe(true);

    await serverSends(r, stateWith([KING, NINE, FOUR], { openingCard: null }));
    expect(selected(KING)).toBe(false);

    await r.unmount();
  });

  it('sends a play under the turn token of the state it was made against, as the server wrote it', async () => {
    const r = await mount(screenUnderTest());
    await r.socket().deliver('game:state', wire(stateWith([KING, NINE]), 0, { turn: 'opaque-7' }), () => {});
    await tap(KING);
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(r.socket().sentAs('game:play').map((p) => [p.cardIds, p.turn])).toEqual([[[KING.id], 'opaque-7']]);

    await r.unmount();
  });

  it('asks for the table again when its own play is refused as out of turn', async () => {
    const r = await mount(screenUnderTest());
    await r.socket().deliver('room:state', room({ status: 'in_progress' }));
    r.socket().reset();
    await tap(KING);
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    const [ack] = r.socket().acks.filter((a) => a.event === 'game:play');
    expect(r.socket().sentAs('game:rejoin')).toEqual([]);
    await act(async () => {
      ack.answer({ ok: false, code: 'NOT_YOUR_TURN' });
    });
    expect(r.socket().sentAs('game:rejoin')).toHaveLength(1);

    await r.unmount();
  });

  it('keeps a staged card the acknowledged play left in the hand', async () => {
    const r = await mount(screenUnderTest());
    await tap(KING);
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(r.socket().sentAs('game:play').map((p) => p.cardIds)).toEqual([[KING.id]]);
    await tap(NINE);

    await serverSends(
      r,
      stateWith([NINE], {
        currentTurnIndex: 1,
        lastPlayedCombination: { type: 'single', cards: [KING], strength: 11 },
        lastPlayedBy: 0,
      })
    );
    expect(selected(NINE)).toBe(true);

    await r.unmount();
  });

  it('survives GIOCA, and keeps all of it while the hand holds still, as on a rejected play', async () => {
    const r = await mount(screenUnderTest());
    await tap(KING);
    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });

    await serverSends(r, stateWith([card('K', 'hearts'), card('9', 'spades')]));
    expect(selected(KING)).toBe(true);
    expect(selected(NINE)).toBe(false);

    await r.unmount();
  });

  it('leaves a selection alone while the round is still being played', async () => {
    const r = await mount(screenUnderTest());
    await tap(KING);

    await serverSends(r, stateWith([KING, NINE], { currentTurnIndex: 1 }));
    expect(selected(KING)).toBe(true);

    await r.unmount();
  });
});
