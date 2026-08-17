// tests/native/offlineResume.test.tsx — an offline match survives the app dying.
//
// lib/offlineSave.ts is covered on its own; what cannot be checked there is the
// wiring: that the provider writes under the key it later reads, that the write
// happens without anyone asking for it, and that what comes back is the same
// match rather than a fresh deal. Two providers, one storage between them —
// which is exactly what a kill and a relaunch look like.
import { test, expect, beforeEach } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGame } from "@/context/GameContext";
import { OFFLINE_SAVE_KEY, decodeOfflineSave } from "@/lib/offlineSave";

const SETUP = [
  { name: "Ana", type: "human" as const },
  { name: "Luan", type: "ai" as const, personality: "luan" as const },
];

/** Reports the bits of context state the persistence is supposed to carry. */
function Probe() {
  const { gameState, hasSavedGame, resumeGame, setupGame, resetGame, selectCard, playSelected } =
    useGame();
  // The opening play is forced to the 3♠, so it is the one move that is always
  // legal and always available without reading the engine's rules here.
  const playOpening = () => {
    const start = gameState?.startCard;
    if (start) selectCard(start.id);
  };
  return (
    <>
      <Text testID="hand">{gameState ? String(gameState.players[0].hand.length) : "none"}</Text>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Pressable testID="setup" onPress={() => setupGame(SETUP, "free_for_all")}>
        <Text>setup</Text>
      </Pressable>
      <Pressable testID="resume" onPress={() => resumeGame()}><Text>resume</Text></Pressable>
      <Pressable testID="reset" onPress={() => resetGame()}><Text>reset</Text></Pressable>
      <Pressable testID="select" onPress={playOpening}><Text>select</Text></Pressable>
      <Pressable testID="play" onPress={() => playSelected()}><Text>play</Text></Pressable>
    </>
  );
}

// This RNTL renders on a concurrent root, so render() is a promise.
const mount = () => render(<GameProvider><Probe /></GameProvider>);
type View = Awaited<ReturnType<typeof mount>>;

// Tearing a concurrent root down outside act() leaves the next render with an
// empty tree, and the failure surfaces in whichever test runs after this one.
const unmount = async (r: View) => { await act(async () => { r.unmount(); }); };

const textOf = (r: View, id: string) => r.getByTestId(id).props.children as string;
const press = async (r: View, id: string) => {
  await act(async () => { fireEvent.press(r.getByTestId(id)); });
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("a match started and then abandoned is offered back, with its hand intact", async () => {
  const first = await mount();
  await press(first, "setup");

  const hand = textOf(first, "hand");
  expect(hand).not.toBe("none");

  // Nobody saved anything: starting the match is all that happened.
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(OFFLINE_SAVE_KEY)).not.toBeNull();
  });

  await unmount(first);
  const second = await mount();

  await waitFor(() => expect(textOf(second, "saved")).toBe("true"));
  await press(second, "resume");
  expect(textOf(second, "hand")).toBe(hand);
});

test("the save tracks the game rather than being written once", async () => {
  const r = await mount();
  await press(r, "setup");
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(OFFLINE_SAVE_KEY)).not.toBeNull();
  });

  const before = decodeOfflineSave(await AsyncStorage.getItem(OFFLINE_SAVE_KEY));
  await press(r, "select");
  await press(r, "play");

  await waitFor(async () => {
    const after = decodeOfflineSave(await AsyncStorage.getItem(OFFLINE_SAVE_KEY));
    expect(after).not.toEqual(before);
  });
});

// Leaving a game deliberately is not the same as being killed mid-hand. If the
// save outlived resetGame, the home screen would keep offering a match the
// player already walked away from.
test("leaving the game clears the save", async () => {
  const r = await mount();
  await press(r, "setup");
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(OFFLINE_SAVE_KEY)).not.toBeNull();
  });

  await press(r, "reset");
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(OFFLINE_SAVE_KEY)).toBeNull();
  });
  expect(textOf(r, "saved")).toBe("false");
});

test("with nothing stored, there is nothing to offer", async () => {
  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("false"));
  await press(r, "resume");
  expect(textOf(r, "hand")).toBe("none");
});
