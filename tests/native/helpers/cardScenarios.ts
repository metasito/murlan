import { createElement } from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import type { CardScope } from '@/components/table/cardRects';
import { dealCards, type GameState } from '@/lib/game/gameEngine';
import { card, seat, state } from '../../support/game.ts';
import { frames } from './exchangeLegs';
import { throwPair } from './landing';

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
  state(
    { players: dealCards(4).hands.map((h, i) => seat(i, h)), firstPlayMade: true, ...overrides }
  );

/** `air` and `rest` bracket one throw; `frame` is every frame of a deal or an exchange. */
export type CardMoment = 'air' | 'rest' | 'frame';

export interface CardScenario {
  name: string;
  /** The scope whose cards are in the air at some judged moment. */
  flying: CardScope;
  /** Mounts, calls `judge` at each moment the scenario is judged on, and unmounts. */
  play(judge: (at: CardMoment) => void): Promise<void>;
}

const exchangeState = (): GameState =>
  state(
    { players: [
      seat(0, [card('5', 'hearts'), card('K', 'diamonds'), card('2', 'spades')]),
      seat(1, [card('4', 'clubs')]),
      seat(2, [card('6', 'hearts')]),
    ],
      firstPlayMade: true,
      exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), twoJokerException: false },
    }
  );

export const cardScenarios: readonly CardScenario[] = [
  {
    name: 'a throw, in the air and at rest',
    flying: 'pile',
    async play(judge) {
      const view = await throwPair(3);
      await frames(96);
      if (screen.queryAllByTestId('flying-card', HIDDEN).length === 0) throw new Error('the throw is not in the air at 96 ms');
      judge('air');
      await frames(2000);
      if (screen.queryAllByTestId('flying-card', HIDDEN).length > 0) throw new Error('the throw is still in the air at 2096 ms');
      judge('rest');
      await view.unmount();
    },
  },
  {
    name: 'a deal',
    flying: 'deal',
    async play(judge) {
      const view = await render(cardTable(dealtTable({ firstPlayMade: false })));
      await frames(1600, () => judge('frame'));
      await view.unmount();
    },
  },
  {
    name: 'an exchange',
    flying: 'leg',
    async play(judge) {
      const view = await render(cardTable(exchangeState()));
      await frames(3000, () => judge('frame'));
      await view.unmount();
    },
  },
];
