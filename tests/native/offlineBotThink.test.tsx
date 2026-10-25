// tests/native/offlineBotThink.test.tsx — an offline bot thinks as long as an online one (D30).
import { test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGameSession, useGameTable } from "@/context/GameContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { useOfflineDriver } from "@/context/offlineDriver";
import { encodeOfflineSave, OFFLINE_SAVE_KEY } from "@/lib/offlineSave";
import { BOT_THINK_MS } from "@/lib/game/turnSchedule";
import { buildCombination, type Card, type GameState } from "@/lib/game/gameEngine";
import { aThreePlayed } from "../support/game.ts";

const card = (rank: string, suit: string): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false } as Card);

/** Gent, a bot, on move over Luan's single. */
const botOnMove = (): GameState => ({
  players: [
    { id: "player_0", name: "Ana", type: "human", hand: [card("4", "clubs"), card("6", "clubs")] },
    { id: "player_1", name: "Gent", type: "bot", hand: [card("7", "clubs"), card("8", "clubs")] },
    { id: "player_2", name: "Luan", type: "bot", hand: [card("9", "clubs"), card("10", "clubs")] },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: buildCombination([card("K", "hearts")]),
  lastPlayedBy: 2,
  passCount: 0,
  gameMode: "free_for_all",
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 1, kind: "play", seat: 2 },
} as GameState);

function Probe() {
  const { hasSavedGame, resumeGame } = useGameSession();
  const { gameState } = useGameTable();
  useOfflineDriver();
  return (
    <>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="seq">{String(gameState?.lastMove.seq ?? "-")}</Text>
      <Pressable testID="resume" onPress={() => resumeGame()}><Text>resume</Text></Pressable>
    </>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test("an offline bot has not moved at 1100 ms, and has at BOT_THINK_MS", async () => {
  await AsyncStorage.setItem(
    OFFLINE_SAVE_KEY,
    encodeOfflineSave({
      gameState: botOnMove(),
      match: { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
      dealFirstSeat: 0,
    })
  );
  const view = await render(
    <NotificationProvider>
      <GameProvider>
        <Probe />
      </GameProvider>
    </NotificationProvider>
  );
  await waitFor(() => expect(view.getByTestId("saved").props.children).toBe("true"));
  await act(async () => {
    fireEvent.press(view.getByTestId("resume"));
  });
  expect(view.getByTestId("seq").props.children).toBe("1");

  await act(async () => {
    jest.advanceTimersByTime(1100);
  });
  expect(view.getByTestId("seq").props.children).toBe("1");
  await act(async () => {
    jest.advanceTimersByTime(BOT_THINK_MS - 1100);
  });
  expect(view.getByTestId("seq").props.children).toBe("2");
  await act(async () => {
    view.unmount();
  });
});
