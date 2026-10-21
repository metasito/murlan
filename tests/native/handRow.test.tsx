// tests/native/handRow.test.tsx — the hand row gates arranging on the exchange, rendered without
// the table around it.
//
// While a card is withheld or lent the fan is drawn without the state's hand, so a move there
// would land a slot away from where it was asked for: the row turns arranging off. A card offers
// its move actions exactly when the row passes `onReorder`, which is what is read here.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { screen, render, fireEvent } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { HandRow } from '@/components/table/handRow';
import type { TableFacts } from '@/components/table/stagedPlay';
import type { ExchangeStages } from '@/components/table/exchangeModel';
import type { ExchangeAnnounceData } from '@/lib/game/sharedGameFlow';
import type { Card, Rank } from '@/lib/game/gameEngine';
import { stillSelection, storeOf } from './tapHelpers';

const card = (rank: Rank): Card => ({ id: `${rank}_spades`, suit: 'spades', rank, isJoker: false });
const HAND = [card('3'), card('4'), card('5')];
const RECEIVED = HAND[1];

const facts: TableFacts = {
  hand: HAND,
  demand: { toBeat: null, mustInclude: null },
  isMyTurn: false,
  isFinished: false,
};

const ANNOUNCED: ExchangeAnnounceData = {
  winnerName: 'Ana',
  loserName: 'Besi',
  winnerIdx: 0,
  loserIdx: 1,
  twoJokerException: false,
  cardReceived: RECEIVED,
  cardGiven: card('7'),
};
const stages = (receive: ExchangeStages['receive'], give: ExchangeStages['give'] = 'landed'): ExchangeStages => ({
  key: '1>0',
  receive,
  give,
  ready: false,
});

function view(exchange: { shown: ExchangeAnnounceData | null; stages: ExchangeStages }, moveTo = jest.fn()) {
  return (
    <HandRow
      facts={facts}
      turnShown={false}
      viewerSeat={0}
      arrangement={{ arranged: HAND, moveTo, order: HAND.map((c) => c.id) }}
      exchange={{ ...exchange, giveableIds: undefined, lifted: makeMutable<string[]>([]) }}
      deal={{ key: 1, hand: undefined }}
      geometry={{ availW: 600, roomW: 456, bottomPad: 0, scale: 1, onOrigins: () => {} }}
      selection={{ store: storeOf(), ui: stillSelection(), onActivate: () => {} }}
    />
  );
}

const movable = () =>
  screen
    .queryAllByRole('button')
    .filter((node) => node.props.accessibilityActions?.some((a: { name: string }) => a.name === 'moveCardRight'));

describe('the hand row arranges only a hand it draws whole', () => {
  it('offers every card its moves, and a move reaches the arrangement', async () => {
    const moveTo = jest.fn();
    await render(view({ shown: null, stages: stages('waiting') }, moveTo));
    expect(movable()).toHaveLength(HAND.length);

    await fireEvent(movable()[0], 'accessibilityAction', { nativeEvent: { actionName: 'moveCardRight' } });
    expect(moveTo).toHaveBeenCalledWith(HAND[0].id, 1);
  });

  it('turns arranging off while a received card is still in the air', async () => {
    await render(view({ shown: ANNOUNCED, stages: stages('flying') }));
    expect(screen.queryAllByRole('button')).toHaveLength(HAND.length - 1);
    expect(movable()).toHaveLength(0);
  });

  it('turns it off while the given card is lent back, before it leaves', async () => {
    await render(view({ shown: ANNOUNCED, stages: stages('landed', 'waiting') }));
    expect(screen.queryAllByRole('button')).toHaveLength(HAND.length + 1);
    expect(movable()).toHaveLength(0);
  });

  it('turns it back on once the card has landed', async () => {
    await render(view({ shown: ANNOUNCED, stages: stages('landed') }));
    expect(movable()).toHaveLength(HAND.length);
  });
});
