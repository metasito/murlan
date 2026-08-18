// tests/native/stagedSelection.test.tsx — a play can be staged while somebody
// else is thinking.
//
// With three opponents the viewer spends three-odd seconds a round holding a
// hand they were not allowed to touch, and then starts a 20s clock from a blank
// selection. Selection is now open at all times; only the submission is gated
// on the turn, which `playBtnValid` already does.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text, Pressable } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/sounds', () => ({
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import * as Haptics from 'expo-haptics';
import { playCardSelect } from '@/lib/sounds';
import { GameTable } from '@/components/GameTable';
import { GameProvider, useGame } from '@/context/GameContext';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

const SEVEN_H = card('7', 'hearts');
const SEVEN_C = card('7', 'clubs');
const HAND = [SEVEN_H, SEVEN_C, card('9', 'spades')];

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const state = (currentTurnIndex: number): GameState => ({
  players: [seat('player_0', 'Ana', HAND), seat('player_1', 'Besi', HAND)],
  currentTurnIndex,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const noop = () => {};

const table = (opts: {
  currentTurnIndex: number;
  selectedIds: string[];
  spectating?: boolean;
  onSelectCard?: (id: string) => void;
  onPlay?: (ids: string[]) => void;
}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={state(opts.currentTurnIndex)}
      viewerSeat={0}
      spectating={opts.spectating}
      selectedIds={opts.selectedIds}
      onSelectCard={opts.onSelectCard ?? noop}
      onPlay={opts.onPlay ?? noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      roundLabel="Partita"
    />
  </SafeAreaProvider>
);

const pressCard = async (c: Card) => {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(cardSpokenName(c, t)));
  });
};

const giocaDisabled = () =>
  screen.getByTestId('btn-gioca').props.accessibilityState?.disabled;

describe('selecting a card out of turn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is accepted, with the usual haptic and select sound', async () => {
    const onSelectCard = jest.fn<(id: string) => void>();
    // Seat 1 is on move; the viewer sits at seat 0.
    const r = await render(table({ currentTurnIndex: 1, selectedIds: [], onSelectCard }));

    await pressCard(SEVEN_H);

    expect(onSelectCard).toHaveBeenCalledWith(SEVEN_H.id);
    expect(playCardSelect).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Haptics.selectionAsync)).toHaveBeenCalledTimes(1);

    await r.unmount();
  });

  it('leaves GIOCA dim until the turn arrives, then lights it without a re-tap', async () => {
    const onPlay = jest.fn<(ids: string[]) => void>();
    const staged = [SEVEN_H.id, SEVEN_C.id];
    const r = await render(table({ currentTurnIndex: 1, selectedIds: staged, onPlay }));
    expect(giocaDisabled()).toBe(true);

    await act(async () => r.rerender(table({ currentTurnIndex: 0, selectedIds: staged, onPlay })));
    expect(giocaDisabled()).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-gioca'));
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect([...onPlay.mock.calls[0][0]].sort()).toEqual([SEVEN_C.id, SEVEN_H.id]);

    await r.unmount();
  });

});

// ─── Offline: an AI turn must not wipe the staging ────────────────────────────

function AiTurnProbe() {
  const { gameState, selectedCards, setupGame, selectCard, runAITurn } = useGame();
  return (
    <>
      <Text testID="selection">{selectedCards.join(",")}</Text>
      <Text testID="turn">{gameState ? String(gameState.currentTurnIndex) : "-"}</Text>
      <Pressable
        testID="setup"
        onPress={() =>
          setupGame(
            [
              { name: 'Luan', type: 'ai', personality: 'luan' },
              { name: 'Drita', type: 'ai', personality: 'drita' },
            ],
            'free_for_all'
          )
        }
      >
        <Text>setup</Text>
      </Pressable>
      <Pressable testID="stage" onPress={() => selectCard('staged_card')}>
        <Text>stage</Text>
      </Pressable>
      <Pressable testID="ai" onPress={() => runAITurn()}>
        <Text>ai</Text>
      </Pressable>
    </>
  );
}

describe('an AI taking its turn offline', () => {
  it('leaves the staged selection alone', async () => {
    // Two AI seats, so whichever holds the 3♠ is on move and `runAITurn` has a
    // turn to take without the test having to play one first.
    const r = await render(
      <GameProvider>
        <AiTurnProbe />
      </GameProvider>
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('setup'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('stage'));
    });
    expect(screen.getByTestId('selection').props.children).toBe('staged_card');

    const before = screen.getByTestId('turn').props.children;
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai'));
    });
    expect(screen.getByTestId('turn').props.children).not.toBe(before);
    expect(screen.getByTestId('selection').props.children).toBe('staged_card');

    await r.unmount();
  });
});
