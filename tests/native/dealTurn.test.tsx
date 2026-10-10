// tests/native/dealTurn.test.tsx — the viewer's turn is given when the deal lands, not from its first frame (#1432).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { HAND_SCALE, HAND_SCALE_ON_TURN } from '@/components/cardFaceModel';
import { dealCards, type GameState, type Player } from '@/lib/game/gameEngine';
import { Colors } from '@/lib/theme';
import { en } from '@/locales/en';
import { bootFeedback } from './helpers/feedback';

const HIDDEN_TOO = { includeHiddenElements: true };

const freshDeal = (): GameState => ({
  players: dealCards(4).hands.map((hand, i) => ({ id: `p${i}`, name: `P${i}`, hand, type: 'human' }) as Player),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
});

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
    <GameTable gameState={gameState} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
  </SafeAreaProvider>
);

const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));
const dealing = () => JSON.stringify(screen.toJSON()).includes('"dealing":"true"');
const chipReadsYourTurn = () =>
  within(screen.getByTestId('game-hud-stack')).queryByText(en['gameShared.yourTurn'], HIDDEN_TOO) !== null;
const chipIsLit = () =>
  JSON.stringify(screen.getByTestId('turn-chip-dot', HIDDEN_TOO).props.style).includes(Colors.goldLit);
const giocaIsLit = () => {
  const label = within(screen.getByTestId('btn-gioca')).getByText(en['gameTable.playLabelGioca'], HIDDEN_TOO);
  return StyleSheet.flatten(label.props.style).color === Colors.bg;
};
const handCardW = () => {
  const [card] = screen.getAllByTestId(/^hand-card-/, HIDDEN_TOO);
  return StyleSheet.flatten(card.props.style).width as number;
};

describe("the viewer's turn waits for the deal to land", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows no turn while the cards fly, and gives it once they land', async () => {
    const view = await render(table(freshDeal()));
    await advance(400);
    expect(dealing()).toBe(true);
    expect(chipReadsYourTurn()).toBe(false);
    expect(chipIsLit()).toBe(false);
    expect(giocaIsLit()).toBe(false);
    const dealtW = handCardW();

    for (let ms = 0; dealing() && ms < 3000; ms += 160) await advance(160);
    expect(dealing()).toBe(false);
    expect(chipReadsYourTurn()).toBe(true);
    expect(chipIsLit()).toBe(true);
    expect(giocaIsLit()).toBe(true);
    expect(handCardW() / dealtW).toBeCloseTo(HAND_SCALE_ON_TURN / HAND_SCALE, 2);
    await view.unmount();
  }, 20_000);
});
