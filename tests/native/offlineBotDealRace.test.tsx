// tests/native/offlineBotDealRace.test.tsx — in a zero-think build the bot still waits for the deal's own flag.
import { test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import React, { useEffect } from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGameSession, useGameTable } from "@/context/GameContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { useOfflineDriver } from "@/context/offlineDriver";
import { encodeOfflineSave, OFFLINE_SAVE_KEY } from "@/lib/offlineSave";
import { buildCombination, type Card, type GameState } from "@/lib/game/gameEngine";
import { aThreePlayed } from "../support/game.ts";

jest.mock("@/lib/e2eConfig", () => ({ ...jest.requireActual<object>("@/lib/e2eConfig"), E2E_FAST: true }));

const useGame = () => ({ ...useGameSession(), ...useGameTable() });
const card = (rank: string, suit: string): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false } as Card);

const botOnMove = (): GameState => ({
  players: [
    { id: "player_0", name: "Ana", type: "human", hand: [card("4", "clubs"), card("6", "clubs")] },
    { id: "player_1", name: "Gent", type: "bot", hand: [card("7", "clubs"), card("8", "clubs")] },
    { id: "player_2", name: "Luan", type: "bot", hand: [card("9", "clubs"), card("10", "clubs")] },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: buildCombination([card("3", "hearts")]),
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: "free_for_all",
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: "deal" },
} as GameState);

/** The table raises the deal's flag from an effect of its own, which runs before the driver's. */
function Table({ onDealing }: { onDealing: (dealing: boolean) => void }) {
  useEffect(() => onDealing(true), [onDealing]);
  return null;
}

function Probe() {
  const { gameState, hasSavedGame, resumeGame } = useGame();
  const { onDealing } = useOfflineDriver();
  return (
    <>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="move">{gameState?.lastMove.kind ?? "-"}</Text>
      <Pressable testID="resume" onPress={() => resumeGame()}><Text>resume</Text></Pressable>
      {gameState && <Table onDealing={onDealing} />}
      <Pressable testID="landed" onPress={() => onDealing(false)}><Text>landed</Text></Pressable>
    </>
  );
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
});

test("a bot does not move in the commit that raises the deal's flag, and does once it lands", async () => {
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
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  expect(view.getByTestId("move").props.children).toBe("deal");
  await act(async () => {
    fireEvent.press(view.getByTestId("landed"));
  });
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  expect(view.getByTestId("move").props.children).not.toBe("deal");
  await act(async () => {
    view.unmount();
  });
});
