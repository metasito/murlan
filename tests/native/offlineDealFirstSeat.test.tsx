// tests/native/offlineDealFirstSeat.test.tsx — #803: a blind critique found
// the rematch-after-a-finished-match branch untested at the behavioral
// level anywhere in the repo — only a source scan stood over it, and the
// critic defeated that scan with a hand-rolled rotation and a decoy comment.
// This drives the real `GameContext` callbacks a results screen calls
// (`startNextHand`, `startNewMatch`) against a hand that has already ended,
// with the deal already rotated once, so a further rotation and a reset land
// on different seats and neither result can be a coincidence.
import { test, expect, beforeEach } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGame } from "@/context/GameContext";
import { OFFLINE_SAVE_KEY, OFFLINE_SAVE_VERSION, decodeOfflineSave } from "@/lib/offlineSave";

const FOUR_PLAYERS = [
  { name: "Ana", type: "human" as const },
  { name: "Luan", type: "ai" as const, personality: "luan" as const },
  { name: "Drita", type: "ai" as const, personality: "drita" as const },
  { name: "Gent", type: "ai" as const, personality: "gent" as const },
];

/** One manche into a still-running match, already dealt from seat 1. */
const handJustEndedSave = () =>
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
      roundWinner: null,
      gameOver: true,
      rankings: ["player_2", "player_0", "player_3", "player_1"],
      firstPlayMade: true,
    },
    match: {
      length: "match",
      target: 21,
      scores: {},
      hands: [],
      over: false,
      winners: [],
      isDraw: false,
    },
    rematchAnswers: {},
    players: FOUR_PLAYERS,
    gameMode: "free_for_all",
    dealFirstSeat: 1,
  });

function Probe() {
  const { hasSavedGame, resumeGame, startNextHand, startNewMatch } = useGame();
  return (
    <>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Pressable testID="resume" onPress={() => resumeGame()}>
        <Text>resume</Text>
      </Pressable>
      <Pressable testID="next" onPress={() => startNextHand()}>
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
    <GameProvider>
      <Probe />
    </GameProvider>
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
  const save = decodeOfflineSave(await AsyncStorage.getItem(OFFLINE_SAVE_KEY));
  return save?.dealFirstSeat ?? null;
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("the next hand of a running match rotates the deal one seat further (#803)", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, handJustEndedSave());
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
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, handJustEndedSave());
  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));

  await press(r, "resume");
  await press(r, "newMatch");

  await waitFor(async () => {
    expect(await savedDealFirstSeat()).toBe(0);
  });
  await unmount(r);
});
