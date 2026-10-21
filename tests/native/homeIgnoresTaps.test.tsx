// tests/native/homeIgnoresTaps.test.tsx — a tap on a hand card commits nothing outside the table.
import { expect, it, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { activate } from './tapHelpers';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { GameProvider } from '@/context/GameContext';
import { useLocalSession, useLocalTable } from '@/context/gameHooks';
import { NotificationProvider } from '@/context/NotificationContext';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import type { GameState } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const noop = () => {};

function Home({ onRender }: { onRender: () => void }) {
  const { setupGame } = useLocalSession();
  onRender();
  return (
    <Pressable
      testID="setup"
      onPress={() =>
        setupGame(
          [
            { name: 'Ana', type: 'human' },
            { name: 'Luan', type: 'bot', personality: 'luan' },
          ],
          'free_for_all'
        )
      }
    >
      <Text>setup</Text>
    </Pressable>
  );
}

function Table({ onState }: { onState: (s: GameState | null) => void }) {
  const { gameState, playCards, passTurn } = useLocalTable();
  useEffect(() => onState(gameState), [gameState, onState]);
  if (!gameState) return null;
  return (
    <GameTable
      gameState={gameState}
      viewerSeat={0}
      onPlay={playCards}
      onPass={passTurn}
      onQuit={noop}
      onExchangeGive={noop}
    />
  );
}

it('selecting a card renders no useLocalSession consumer', async () => {
  const homeRenders = jest.fn();
  const shown: { state: GameState | null } = { state: null };
  const onState = (s: GameState | null) => {
    shown.state = s;
  };
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <GameProvider>
          <Home onRender={homeRenders} />
          <Table onState={onState} />
        </GameProvider>
      </NotificationProvider>
    </SafeAreaProvider>
  );
  const atMount = homeRenders.mock.calls.length;
  await act(async () => {
    fireEvent.press(screen.getByTestId('setup'));
  });
  const card = shown.state!.players[0].hand[0];
  const node = () => screen.getByLabelText(cardSpokenName(card, t), { includeHiddenElements: true });
  const before = homeRenders.mock.calls.length;
  expect(before).toBeGreaterThan(atMount);

  await act(async () => {
    await activate(node());
  });

  expect(node().props.accessibilityState?.selected).toBe(true);
  expect(homeRenders.mock.calls.length).toBe(before);

  await r.unmount();
});

function Mover() {
  const { gameState, playCards, passTurn } = useLocalTable();
  return (
    <Pressable
      testID="move"
      onPress={() => {
        if (!gameState) return;
        const seat = gameState.players[gameState.currentTurnIndex];
        if (!playCards([gameState.openingCard?.id ?? seat.hand[0].id])) passTurn();
      }}
    >
      <Text>move</Text>
    </Pressable>
  );
}

it('a move renders no useLocalSession consumer', async () => {
  const homeRenders = jest.fn();
  const shown: { state: GameState | null } = { state: null };
  const onState = (s: GameState | null) => {
    shown.state = s;
  };
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <GameProvider>
          <Home onRender={homeRenders} />
          <Table onState={onState} />
          <Mover />
        </GameProvider>
      </NotificationProvider>
    </SafeAreaProvider>
  );
  await act(async () => {
    fireEvent.press(screen.getByTestId('setup'));
  });
  const dealt = shown.state;
  const before = homeRenders.mock.calls.length;

  await act(async () => {
    fireEvent.press(screen.getByTestId('move'));
  });

  expect(shown.state).not.toBe(dealt);
  expect(homeRenders.mock.calls.length).toBe(before);

  await r.unmount();
});
