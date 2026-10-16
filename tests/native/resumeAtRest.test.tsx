// tests/native/resumeAtRest.test.tsx — an offline match picked up after the app died shows its last
// play already on the pile: it was thrown before the kill, so it does not fly again (#1625).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

import GameScreen from '@/app/game';
import { GameProvider, useGame } from '@/context/GameContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { encodeOfflineSave, OFFLINE_SAVE_KEY } from '@/lib/offlineSave';
import type { Card, Combination, GameState, Rank, Suit } from '@/lib/game/gameEngine';
import { bootFeedback, settle, sounds } from './helpers/feedback';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const PAIR: Combination = { type: 'pair', cards: [card('9', 'clubs'), card('9', 'hearts')], strength: 9 };
const NAMES = ['Ana', 'Luan', 'Gent', 'Era'];

const saved = (): GameState => ({
  players: NAMES.map((name, i) => ({
    id: `player_${i}`,
    name,
    type: i === 0 ? 'human' : 'bot',
    hand: [card('3', 'spades'), card('4', 'spades'), card('5', 'spades')].map((c) => ({ ...c, id: `${c.id}_${i}` })),
  })),
  currentTurnIndex: 0,
  lastPlayedCombination: PAIR,
  lastPlayedBy: 3,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
});

function Screen() {
  const { gameState, hasSavedGame, resumeGame } = useGame();
  if (gameState) return <GameScreen />;
  return (
    <Pressable testID="resume" onPress={() => resumeGame()}>
      <Text>{String(hasSavedGame)}</Text>
    </Pressable>
  );
}

const fliers = (view: Awaited<ReturnType<typeof render>>) => view.queryAllByTestId('flying-card', { includeHiddenElements: true }).length;
const resting = (view: Awaited<ReturnType<typeof render>>) => view.queryAllByTestId('pile-card', { includeHiddenElements: true }).length;

describe('an offline match resumed with a play on the pile', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('mounts that play at rest: no flight and no landing sound', async () => {
    await AsyncStorage.setItem(
      OFFLINE_SAVE_KEY,
      encodeOfflineSave({
        gameState: saved(),
        match: { length: 'match', target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
        players: NAMES.map((name, i) => ({ name, type: i === 0 ? 'human' : 'bot' })),
        gameMode: 'free_for_all',
        dealFirstSeat: 0,
      })
    );
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <NotificationProvider>
          <GameProvider>
            <Screen />
          </GameProvider>
        </NotificationProvider>
      </SafeAreaProvider>
    );
    await waitFor(() => expect(view.getByTestId('resume').props.children).toBeDefined());
    await waitFor(() => expect(view.getByText('true')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('resume'));
    });

    expect(resting(view)).toBe(PAIR.cards.length);
    expect(fliers(view)).toBe(0);
    await settle(1500);
    expect(resting(view)).toBe(PAIR.cards.length);
    expect(fliers(view)).toBe(0);
    expect(sounds()).not.toContain('combo');
    expect(sounds()).not.toContain('play');
    await act(async () => view.unmount());
  });
});
