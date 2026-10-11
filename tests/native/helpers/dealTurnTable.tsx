import { jest } from '@jest/globals';
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { dealCards, type GameState, type Player } from '@/lib/game/gameEngine';

export const freshDeal = (): GameState => ({
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

export const table = (gameState: GameState, { width, height } = { width: 844, height: 390 }) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
    <GameTable gameState={gameState} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
  </SafeAreaProvider>
);

export const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));
export const dealing = () => JSON.stringify(screen.toJSON()).includes('"dealing":"true"');
