import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { api, bootFeedback, effects, haptics, settle, sounds } from './helpers/feedback';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const SEVEN_H: Card = { id: '7_hearts', rank: '7', suit: 'hearts', isJoker: false };
const seat = (id: string, hand: Card[]): Player => ({ id, name: id, hand, type: 'human' });
const state: GameState = {
  players: [seat('player_0', [SEVEN_H]), seat('player_1', [])],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};
const noop = () => {};

describe('a card press', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts one source and fires one haptic, and touches neither the session nor a context', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={state} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SafeAreaProvider>
    );
    await settle(2000);
    const before = effects().length;
    const contexts = api().contexts.length;
    api().log.length = 0;
    await act(async () => {
      fireEvent.press(screen.getByLabelText(cardSpokenName(SEVEN_H, t)));
    });
    await settle();
    expect(sounds().slice(before)).toEqual(['select']);
    expect(haptics().slice(-1)).toEqual(['selection']);
    expect(api().log).toEqual([]);
    expect(api().contexts.length).toBe(contexts);
    await r.unmount();
  });
});
