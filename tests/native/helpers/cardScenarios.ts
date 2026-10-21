import { createElement } from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import type { CardScope } from '@/components/table/cardRects';
import { dealCards, type Card, type GameState } from '@/lib/game/gameEngine';
import { card, seat, state } from '../../support/game.ts';
import { frames } from './exchangeLegs';
import { PAIR, throwPair } from './landing';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const HIDDEN = { includeHiddenElements: true };
const noop = () => {};

export const cardTable = (gameState: GameState) =>
  createElement(
    SafeAreaProvider,
    { initialMetrics: METRICS },
    createElement(GameTable, { gameState, viewerSeat: 0, onPlay: noop, onPass: noop, onQuit: noop, onExchangeGive: noop })
  );

export const dealtTable = (overrides: Partial<GameState> = {}): GameState =>
  state({ players: dealCards(4).hands.map((h, i) => seat(i, h)), openingCard: null, ...overrides });

/** Seat 3 has just thrown `PAIR`; `emptied`, it threw its last cards and the pile is caught going out. */
export const pairThrownBy3 = (hands: Card[][], emptied: boolean): GameState =>
  state({
    players: hands.map((h, i) => seat(i, i === 3 && emptied ? [] : h)),
    openingCard: null,
    lastPlayedCombination: PAIR,
    lastPlayedBy: 3,
  });

const exchangeState = (): GameState =>
  state({
    players: [
      seat(0, [card('5', 'hearts'), card('K', 'diamonds'), card('2', 'spades')]),
      seat(1, [card('4', 'clubs')]),
      seat(2, [card('6', 'hearts')]),
    ],
    openingCard: null,
    exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), twoJokerException: false },
  });

export type Scenario = 'throw' | 'deal' | 'exchange' | 'goingOut';
export const SCENARIOS: readonly Scenario[] = ['throw', 'deal', 'exchange', 'goingOut'];
/** The scope whose cards are in the air at some frame of each scenario. */
export const FLYING: Readonly<Record<Scenario, CardScope>> = { throw: 'pile', deal: 'deal', exchange: 'leg', goingOut: 'pile' };
/** The throw's frames, in ms: its pair is in the air at `air` and has come to rest by `rest`. */
export const THROW = { air: 96, rest: 2096 } as const;
const LENGTH: Readonly<Record<Scenario, number>> = { throw: THROW.rest, deal: 1600, exchange: 3000, goingOut: 3000 };

const inTheAir = () => screen.queryAllByTestId('flying-card', HIDDEN).length > 0;

const mount = (s: Scenario) => {
  if (s === 'throw') return throwPair(3);
  if (s === 'deal') return render(cardTable(dealtTable({ openingCard: null })));
  if (s === 'exchange') return render(cardTable(exchangeState()));
  return render(cardTable(pairThrownBy3(dealCards(4).hands, true)));
};

/** Mounts the scenario's table, calls `onFrame` with the elapsed ms after every 16 ms frame, and unmounts. */
export async function runScenario(s: Scenario, onFrame: (frame: number) => void): Promise<void> {
  const view = await mount(s);
  await frames(LENGTH[s], (t) => {
    if (s === 'throw' && t === THROW.air && !inTheAir()) throw new Error(`the throw is not in the air at ${t} ms`);
    if (s === 'throw' && t === THROW.rest && inTheAir()) throw new Error(`the throw is still in the air at ${t} ms`);
    onFrame(t);
  });
  await view.unmount();
}
