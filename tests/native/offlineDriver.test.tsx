// tests/native/offlineDriver.test.tsx — the offline table's commands read the state the last one committed.
import { test, expect, beforeEach } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGameSession, useGameTable } from "@/context/GameContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { encodeOfflineSave, OFFLINE_SAVE_KEY } from "@/lib/offlineSave";
import { buildCombination, processPass, type Card, type GameState } from "@/lib/game/gameEngine";

/** Both halves of the provider, for a probe that reads across them. */
const useGame = () => ({ ...useGameSession(), ...useGameTable() });

const card = (rank: string, suit: string): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false } as Card);

/** Ana on move over Luan's single, with two seats still to answer it. */
const trick = (): GameState => ({
  players: [
    { id: "player_0", name: "Ana", type: "human", hand: [card("4", "clubs"), card("6", "clubs")] },
    { id: "player_1", name: "Gent", type: "bot", hand: [card("7", "clubs"), card("8", "clubs")] },
    { id: "player_2", name: "Luan", type: "bot", hand: [card("9", "clubs"), card("10", "clubs")] },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: buildCombination([card("K", "hearts")]),
  lastPlayedBy: 2,
  passCount: 0,
  gameMode: "free_for_all",
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
} as GameState);

function Probe() {
  const { gameState, hasSavedGame, resumeGame, passTurn } = useGame();
  return (
    <>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="turn">{String(gameState?.currentTurnIndex ?? "-")}</Text>
      <Text testID="passes">{String(gameState?.passCount ?? "-")}</Text>
      <Pressable testID="resume" onPress={() => resumeGame()}><Text>resume</Text></Pressable>
      <Pressable
        testID="passTwice"
        onPress={() => {
          passTurn();
          passTurn();
        }}
      >
        <Text>pass twice</Text>
      </Pressable>
    </>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("two passes in one event compose, the second answering the first", async () => {
  await AsyncStorage.setItem(
    OFFLINE_SAVE_KEY,
    encodeOfflineSave({
      gameState: trick(),
      match: { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
      players: [
        { name: "Ana", type: "human" },
        { name: "Gent", type: "bot" },
        { name: "Luan", type: "bot" },
      ],
      gameMode: "free_for_all",
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
    fireEvent.press(view.getByTestId("passTwice"));
  });

  const twice = processPass(processPass(trick()));
  expect(view.getByTestId("turn").props.children).toBe(String(twice.currentTurnIndex));
  expect(view.getByTestId("passes").props.children).toBe(String(twice.passCount));
  await act(async () => {
    view.unmount();
  });
});

const exchange = (winner: "human" | "bot", winnerHand: Card[]): GameState => ({
  ...trick(),
  players: [
    { id: "player_0", name: "Ana", type: "human", hand: [card("4", "clubs")] },
    { id: "player_1", name: "Luan", type: winner, hand: winnerHand },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  exchangePhase: { active: true, winnerIdx: 1, loserIdx: 0, cardFromLoser: card("2", "clubs"), twoJokerException: false },
} as GameState);

function SettleProbe() {
  const { gameState, hasSavedGame, resumeGame, settleExchange } = useGame();
  return (
    <>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="active">{String(gameState?.exchangePhase?.active ?? "-")}</Text>
      <Text testID="loserHand">{gameState ? gameState.players[0].hand.map((c) => c.id).join(",") : "-"}</Text>
      <Pressable testID="resume" onPress={() => resumeGame()}><Text>resume</Text></Pressable>
      <Pressable testID="settle" onPress={() => settleExchange()}><Text>settle</Text></Pressable>
    </>
  );
}

const settled = async (state: GameState) => {
  await AsyncStorage.setItem(
    OFFLINE_SAVE_KEY,
    encodeOfflineSave({
      gameState: state,
      match: { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
      players: [
        { name: "Ana", type: "human" },
        { name: "Luan", type: state.players[1].type },
      ],
      gameMode: "free_for_all",
      dealFirstSeat: 0,
    })
  );
  const view = await render(
    <NotificationProvider>
      <GameProvider>
        <SettleProbe />
      </GameProvider>
    </NotificationProvider>
  );
  await waitFor(() => expect(view.getByTestId("saved").props.children).toBe("true"));
  await act(async () => {
    fireEvent.press(view.getByTestId("resume"));
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("settle"));
  });
  const shown = { active: view.getByTestId("active").props.children, loser: view.getByTestId("loserHand").props.children };
  await act(async () => {
    view.unmount();
  });
  return shown;
};

test("a bot winner gives back its weakest legal card once the table has shown the one it received", async () => {
  expect(await settled(exchange("bot", [card("9", "clubs"), card("6", "clubs")]))).toEqual({
    active: "false",
    loser: "4_clubs,6_clubs",
  });
});

test("a human winner is left to choose", async () => {
  expect(await settled(exchange("human", [card("6", "clubs")]))).toEqual({ active: "true", loser: "4_clubs" });
});

test("a winner holding no card it may give back releases the phase rather than holding the table forever", async () => {
  expect((await settled(exchange("human", []))).active).toBe("false");
});
