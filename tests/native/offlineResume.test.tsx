// tests/native/offlineResume.test.tsx — an offline match survives the app dying.
//
// lib/offlineSave.ts is covered on its own; what cannot be checked there is the
// wiring: that the provider writes under the key it later reads, that the write
// happens without anyone asking for it, and that what comes back is the same
// match rather than a fresh deal. Two providers, one storage between them —
// which is exactly what a kill and a relaunch look like.
import { test, expect, beforeEach, jest } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGameSession, useGameTable } from "@/context/GameContext";
import { OFFLINE_SAVE_KEY, OFFLINE_SAVE_VERSION, decodeOfflineSave } from "@/lib/offlineSave";
import { NotificationProvider, useBanner } from "@/context/NotificationContext";
import { t } from "@/lib/i18n";

/** Both halves of the provider, for a probe that reads across them. */
const useGame = () => ({ ...useGameSession(), ...useGameTable() });

const SETUP = [
  { name: "Ana", type: "human" as const },
  { name: "Luan", type: "bot" as const, personality: "luan" as const },
];

/**
 * A save taken while the between-rounds exchange is open.
 *
 * This is the moment a player is most likely to put the phone down — the hand
 * has just ended and they owe, or are owed, a card — and the one where a bad
 * restore strands them, which is exactly how the two-joker bug presented
 * before it was fixed.
 */
const midExchangeSave = () => {
  const card = { id: "7_hearts", rank: "7", suit: "hearts", isJoker: false };
  return JSON.stringify({
    version: OFFLINE_SAVE_VERSION,
    gameState: {
      players: [
        { id: "player_0", name: "Ana", hand: [card], type: "human" },
        { id: "player_1", name: "Luan", hand: [card], type: "bot", personality: "luan" },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      trickWinner: null,
      roundOver: false,
      finishingOrder: [],
      firstPlayMade: true,
      exchangePhase: {
        active: true,
        winnerIdx: 1,
        loserIdx: 0,
        cardFromLoser: card,
        twoJokerException: true,
      },
    },
    match: { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
    dealFirstSeat: 1,
  });
};

/** Reports the bits of context state the persistence is supposed to carry. */
function Probe() {
  const {
    gameState,
    hasSavedGame,
    resumeGame,
    setupGame,
    resetGame,
    playCards,
    exchangeAnnouncing,
    restored,
  } = useGame();
  // The opening play is forced to the 3♠, so it is the one move that is always
  // legal and always available without reading the engine's rules here.
  const start = gameState?.startCard;
  return (
    <>
      <Text testID="hand">{gameState ? String(gameState.players[0].hand.length) : "none"}</Text>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="exchange">
        {gameState?.exchangePhase?.active
          ? `${gameState.exchangePhase.winnerIdx}>${gameState.exchangePhase.loserIdx}` +
            (gameState.exchangePhase.twoJokerException ? " jokers" : "")
          : "none"}
      </Text>
      <Text testID="announcing">{String(exchangeAnnouncing)}</Text>
      <Text testID="restored">{String(restored)}</Text>
      <Pressable testID="setup" onPress={() => setupGame(SETUP, "free_for_all")}>
        <Text>setup</Text>
      </Pressable>
      <Pressable testID="resume" onPress={() => resumeGame()}><Text>resume</Text></Pressable>
      <Pressable testID="reset" onPress={() => resetGame()}><Text>reset</Text></Pressable>
      <Pressable testID="play" onPress={() => start && playCards([start.id])}><Text>play</Text></Pressable>
      <Pressable testID="playFirst" onPress={() => gameState && playCards([gameState.players[0].hand[0].id])}>
        <Text>play first</Text>
      </Pressable>
    </>
  );
}

function NoticeProbe() {
  const { notification } = useBanner();
  return <Text testID="notice">{notification?.title ?? "none"}</Text>;
}

// This RNTL renders on a concurrent root, so render() is a promise.
const mount = () =>
  render(
    <NotificationProvider>
      <GameProvider>
        <Probe />
        <NoticeProbe />
      </GameProvider>
    </NotificationProvider>
  );
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
  await press(r, "play");

  await waitFor(async () => {
    const after = decodeOfflineSave(await AsyncStorage.getItem(OFFLINE_SAVE_KEY));
    expect(after).not.toEqual(before);
  });
});

// Leaving a game deliberately is not the same as being killed mid-round. If the
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
  expect(textOf(r, "notice")).toBe("none");
  await unmount(r);
});

test("a save an update can no longer read is removed, and the player is told", async () => {
  const stale = JSON.parse(midExchangeSave());
  stale.version = OFFLINE_SAVE_VERSION - 1;
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, JSON.stringify(stale));

  const r = await mount();
  await waitFor(() => expect(textOf(r, "notice")).toBe(t("offlineGame.saveDiscardedTitle")));
  await waitFor(async () => expect(await AsyncStorage.getItem(OFFLINE_SAVE_KEY)).toBeNull());
  expect(textOf(r, "saved")).toBe("false");
  await unmount(r);
});

// The exchange is driven entirely by gameState.exchangePhase, which is
// persisted. The announcement overlay beside it is not, and must not be: it is
// a one-shot that blocks the screen until it is acknowledged, so restoring it
// would put a player back behind a notice about a round they already saw end.
test("a game killed mid-exchange comes back with the exchange, and no stuck overlay", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, midExchangeSave());

  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));
  await press(r, "resume");

  expect(textOf(r, "exchange")).toBe("1>0 jokers");
  expect(textOf(r, "announcing")).toBe("false");
});

/** Ana on move with a free lead, so her first card is always a legal single. */
const freeLeadSave = () => {
  const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
  return JSON.stringify({
    ...JSON.parse(midExchangeSave()),
    gameState: {
      players: [
        { id: "player_0", name: "Ana", hand: [card("7", "hearts"), card("9", "hearts")], type: "human" },
        { id: "player_1", name: "Luan", hand: [card("5", "clubs"), card("8", "clubs")], type: "bot" },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      trickWinner: null,
      roundOver: false,
      finishingOrder: [],
      firstPlayMade: true,
    },
  });
};

// Back from the table to Home leaves the provider's table live; Home's resume must pick that up, not the boot save.
test("resuming again after a move goes back to the live table, not the save the app booted with", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, freeLeadSave());

  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));
  await press(r, "resume");
  expect(textOf(r, "hand")).toBe("2");
  await press(r, "playFirst");
  expect(textOf(r, "hand")).toBe("1");

  expect(textOf(r, "saved")).toBe("true");
  await press(r, "resume");
  expect(textOf(r, "hand")).toBe("1");
  await unmount(r);
});

// GameTable mounts a restored table at rest; a live one it remounts would throw its last play and deal again.
test("resuming the live table mounts it at rest", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, freeLeadSave());
  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));
  await press(r, "resume");
  await press(r, "playFirst");
  expect(textOf(r, "restored")).toBe("false");

  await press(r, "resume");
  expect(textOf(r, "restored")).toBe("true");
  await unmount(r);
});

// Replaced means replaced: resuming after a new deal goes back to the new table, never the stored one.
test("starting a new match leaves nothing of the saved one to resume", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, midExchangeSave());
  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));
  await press(r, "setup");
  const dealt = textOf(r, "hand");
  await press(r, "resume");
  expect(textOf(r, "exchange")).toBe("none");
  expect(textOf(r, "hand")).toBe(dealt);
  await waitFor(async () => {
    const stored = await AsyncStorage.getItem(OFFLINE_SAVE_KEY);
    expect(stored).not.toBe(midExchangeSave());
  });
  await unmount(r);
});

test("a saved match nobody replaced stays resumable", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, midExchangeSave());
  const r = await mount();
  await waitFor(() => expect(textOf(r, "saved")).toBe("true"));
  await press(r, "resume");
  expect(textOf(r, "exchange")).toBe("1>0 jokers");
  await unmount(r);
});

test("a boot read that lands after the table was set up and left offers nothing back", async () => {
  await AsyncStorage.setItem(OFFLINE_SAVE_KEY, freeLeadSave());
  let land: (raw: string | null) => void = () => {};
  const read = jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(
    () => new Promise<string | null>((resolve) => (land = resolve))
  );
  const r = await mount();
  await press(r, "setup");
  await press(r, "reset");
  expect(textOf(r, "saved")).toBe("false");

  await act(async () => land(freeLeadSave()));
  expect(textOf(r, "saved")).toBe("false");
  read.mockRestore();
  await unmount(r);
});
