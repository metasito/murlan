// tests/native/homeIgnoresTaps.test.tsx — a tap on a hand card commits nothing outside the table.
import { expect, it } from '@jest/globals';
import React, { Profiler, useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
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

function Home() {
  const { setupGame } = useLocalSession();
  return (
    <Pressable
      testID="setup"
      onPress={() =>
        setupGame(
          [
            { name: 'Ana', type: 'human' },
            { name: 'Luan', type: 'ai', personality: 'luan' },
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

it('selecting a card commits no render in a useLocalSession consumer', async () => {
  const homeCommits: string[] = [];
  const shown: { state: GameState | null } = { state: null };
  const onState = (s: GameState | null) => {
    shown.state = s;
  };
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <GameProvider>
          <Profiler id="home" onRender={(_id, phase) => homeCommits.push(phase)}>
            <Home />
          </Profiler>
          <Table onState={onState} />
        </GameProvider>
      </NotificationProvider>
    </SafeAreaProvider>
  );
  await act(async () => {
    fireEvent.press(screen.getByTestId('setup'));
  });
  const card = shown.state!.players[0].hand[0];
  const node = () => screen.getByLabelText(cardSpokenName(card, t), { includeHiddenElements: true });
  const before = homeCommits.length;

  await act(async () => {
    fireEvent.press(node());
  });

  expect(node().props.accessibilityState?.selected).toBe(true);
  expect(homeCommits.slice(before)).toEqual([]);

  await r.unmount();
});
