// tests/native/offlineDealFirstSeat.test.tsx — #803: a blind critique found
// the rematch-after-a-finished-match branch untested at the behavioral
// level anywhere in the repo — only a source scan stood over it, and the
// critic defeated that scan with a hand-rolled rotation and a decoy comment.
// This drives the real `GameContext` callbacks a results screen calls
// (`startNextRound`, `startNewMatch`) against a round that has already ended,
// with the deal already rotated once, so a further rotation and a reset land
// on different seats and neither result can be a coincidence.
import { test, expect, beforeEach } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGameSession, useGameTable } from "@/context/GameContext";
import { OFFLINE_SAVE_KEY, OFFLINE_SAVE_VERSION, decodeOfflineSave } from "@/lib/offlineSave";
import { NotificationProvider } from "@/context/NotificationContext";

/** Both halves of the provider, for a probe that reads across them. */
const useGame = () => ({ ...useGameSession(), ...useGameTable() });

const FOUR_PLAYERS = [
  { name: "Ana", type: "human" as const },
  { name: "Luan", type: "bot" as const, personality: "luan" as const },
  { name: "Besnik", type: "bot" as const, personality: "besnik" as const },
  { name: "Gent", type: "bot" as const, personality: "gent" as const },
];

/** One round into a still-running match, already dealt from seat 1. */
const roundJustEndedSave = () =>
  JSON.stringify({
    version: OFFLINE_SAVE_VERSION,
    gameState: {
      players: FOUR_PLAYERS.map((p, i) => ({
        id: `player_${i}`,
        name: p.name,
        hand: [],
        type: p.type,
        personality: p.personality,
      })),
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      trickWinner: null,
      roundOver: true,
      finishingOrder: ["player_2", "player_0", "player_3", "player_1"],
      firstPlayMade: true,
    },
    match: {
      length: "match",
      target: 21,
      scores: {},
      rounds: [],
      over: false,
      winners: [],
      isDraw: false,
    },
    players: FOUR_PLAYERS,
    gameMode: "free_for_all",
    dealFirstSeat: 1,
  });

function Probe() {
  const { hasSavedGame, resumeGame, startNextRound, startNewMatch } = useGame();
  return (
    <>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Pressable testID="resume" onPress={() => resumeGame()}>
        <Text>resume</Text>
      </Pressable>
      <Pressable testID="next" onPress={() => startNextRound()}>
        <Text>next</Text>
      </Pressable>
      <Pressable testID="newMatch" onPress={() => startNewMatch()}>
        <Text>newMatch</Text>
      </Pressable>
    </>
  );
}

const mount = () =>
  render(
    <NotificationProvider>
      <GameProvider>
        <Probe />
      </GameProvider>
    </NotificationProvider>
  );
type View = Awaited<ReturnType<typeof mount>>;

const unmount = async (r: View) => {
  await act(async () => {
    r.unmount();
  });
};
const press = async (r: View, id: string) => {
  await act(async () => {
    fireEvent.press(r.getByTestId(id));
  });
};
const textOf = (r: View, id: string) => r.getByTestId(id).props.children as string;

const savedDealFirstSeat = async () => {
  const stored = decodeOfflineSave(await AsyncStorage.getItem(OFFLINE_SAVE_KEY));
  return stored.kind === "ok" ? stored.save.dealFirstSeat : null;
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("the next round of a running match rotates the deal one seat further (#803)", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, roundJustEndedSave());
  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));

  await press(r, "resume");
  await press(r, "next");

  await waitFor(async () => {
    expect(await savedDealFirstSeat()).toBe(2);
  });
  await unmount(r);
});

test("a rematch after the match ends resets the deal to seat 0, not a further rotation (#803)", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, roundJustEndedSave());
  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));

  await press(r, "resume");
  await press(r, "newMatch");

  await waitFor(async () => {
    expect(await savedDealFirstSeat()).toBe(0);
  });
  await unmount(r);
});
