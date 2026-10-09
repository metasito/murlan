import { jest } from '@jest/globals';
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';
import { GameTable } from '@/components/GameTable';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const NAMES = ['Ana', 'Besi', 'Cimi', 'Drin'];
const handOf = (seatIdx: number, n: number): Card[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${seatIdx}_${i}`, rank: '3', suit: 'spades', isJoker: false }) as Card);
const players: Player[] = NAMES.map((name, i) => ({ id: `player_${i}`, name, hand: handOf(i, 13), type: 'human' }));

export const freshDeal: GameState = {
  players,
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: false,
};

const noop = () => {};
export const table = (gameState: GameState = freshDeal) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

export type Pose = { opacity?: number; transform?: Record<string, number | string>[] };
export const along = (p: Pose, key: string) => Number(p.transform?.find((t) => key in t)?.[key] ?? 1);
export const breath = () => along(getAnimatedStyle(screen.getByTestId('table-felt', { includeHiddenElements: true })) as Pose, 'scale');

export const handPoses = () =>
  screen.getAllByTestId('card-box').map((box) => {
    let n = box.parent;
    while (n && !(n.props.jestAnimatedStyle && typeof StyleSheet.flatten(n.props.style)?.left === 'number')) n = n.parent;
    return getAnimatedStyle(n!) as Pose;
  });

export const frame = () => act(async () => void jest.advanceTimersByTime(16));
