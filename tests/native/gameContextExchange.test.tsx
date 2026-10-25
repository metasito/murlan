// tests/native/gameContextExchange.test.tsx — choosing an exchange card,
// exercised through the real GameProvider rather than a mock.
//
// GameContext used to read the live game state through a ref written during
// render (issue #36); this drives `chooseExchangeCard` the way a player does —
// through the provider's own hooks — so a regression that reverts to a stale read would
// show up as a wrong hand or a missing announcement here, not just as a
// compiler bailout.
import { test, expect } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGameSession, useGameTable } from "@/context/GameContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { useOfflineDriver } from "@/context/offlineDriver";
import { encodeOfflineSave, OFFLINE_SAVE_KEY } from "@/lib/offlineSave";
import { BOT_THINK_MS } from "@/lib/game/turnSchedule";
import type { GameState } from "@/lib/game/gameEngine";
import { emptyRankTally } from "@/lib/game/gameEngine";

/** Both halves of the provider, for a probe that reads across them. */
const useGame = () => ({ ...useGameSession(), ...useGameTable() });

/**
 * A round parked mid-exchange: the human (seat 0) won the round and owes seat
 * 1 a giveback. `4_clubs` is the only card in the winner's hand that the
 * exchange rules (docs/GAME-RULES.md §10) allow to be handed back.
 */
function exchangeState(): GameState {
  return {
    players: [
      {
        id: "player_0",
        name: "Ana",
        type: "human",
        hand: [{ id: "4_clubs", suit: "clubs", rank: "4", isJoker: false }],
      },
      {
        id: "player_1",
        name: "Gent",
        type: "bot",
        hand: [{ id: "3_spades", suit: "spades", rank: "3", isJoker: false }],
      },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: emptyRankTally(),
    lastMove: { seq: 0, kind: "deal" },
    exchangePhase: {
      kind: "open",
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: { id: "3_spades", suit: "spades", rank: "3", isJoker: false },
    },
  };
}

let playResult: boolean | undefined;

function Probe() {
  const {
    gameState,
    exchangeAnnouncing,
    exchangeAnnounceData,
    hasSavedGame,
    resumeGame,
    chooseExchangeCard,
    playCards,
    setupGame,
  } = useGame();
  return (
    <>
      <Pressable testID="resume" onPress={() => resumeGame()}>
        <Text>resume</Text>
      </Pressable>
      <Pressable testID="choose" onPress={() => chooseExchangeCard("4_clubs")}>
        <Text>choose</Text>
      </Pressable>
      <Pressable testID="chooseUnheld" onPress={() => chooseExchangeCard("ace_hearts")}>
        <Text>choose unheld</Text>
      </Pressable>
      <Pressable testID="play" onPress={() => (playResult = playCards(["4_clubs"]))}>
        <Text>play</Text>
      </Pressable>
      <Pressable
        testID="newMatch"
        onPress={() =>
          setupGame(
            [
              { name: "Ana", type: "human" },
              { name: "Gent", type: "bot" },
            ],
            "free_for_all"
          )
        }
      >
        <Text>new match</Text>
      </Pressable>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="active">{String(gameState?.exchangePhase ? gameState.exchangePhase.kind === "open" : "none")}</Text>
      <Text testID="phasePresent">{String(gameState?.exchangePhase !== undefined)}</Text>
      <Text testID="winnerHand">{gameState ? gameState.players[0].hand.map((c) => c.id).join(",") : "-"}</Text>
      <Text testID="loserHand">{gameState ? gameState.players[1].hand.map((c) => c.id).join(",") : "-"}</Text>
      <Text testID="turn">{String(gameState?.currentTurnIndex ?? "-")}</Text>
      <Text testID="announcing">{String(exchangeAnnouncing)}</Text>
      <Text testID="announceGiven">{exchangeAnnounceData?.cardGiven?.id ?? "-"}</Text>
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

const press = async (view: View, id: string) => {
  await act(async () => {
    fireEvent.press(view.getByTestId(id));
  });
};

const shown = (view: View, id: string) => view.getByTestId(id).props.children;

const saveExchange = () =>
  AsyncStorage.setItem(
    OFFLINE_SAVE_KEY,
    encodeOfflineSave({
      gameState: exchangeState(),
      match: { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
      dealFirstSeat: 0,
    })
  );

test("a give the engine refuses opens no announcement, and a valid one after it still does", async () => {
  await saveExchange();
  const view = await mount();
  await waitFor(() => expect(shown(view, "saved")).toBe("true"));
  await press(view, "resume");

  await press(view, "chooseUnheld");

  expect(shown(view, "announcing")).toBe("false");
  expect(shown(view, "active")).toBe("true");
  expect(shown(view, "winnerHand")).toBe("4_clubs");
  expect(shown(view, "loserHand")).toBe("3_spades");

  await press(view, "choose");

  expect(shown(view, "active")).toBe("false");
  expect(shown(view, "announcing")).toBe("true");
  expect(shown(view, "announceGiven")).toBe("4_clubs");

  await view.unmount();
});

test("playCards during an open exchange is refused and moves no card", async () => {
  await saveExchange();
  const view = await mount();
  await waitFor(() => expect(shown(view, "saved")).toBe("true"));
  await press(view, "resume");
  playResult = undefined;

  await press(view, "play");

  expect(playResult).toBe(false);
  expect(shown(view, "active")).toBe("true");
  expect(shown(view, "winnerHand")).toBe("4_clubs");
  expect(shown(view, "loserHand")).toBe("3_spades");

  await view.unmount();
});

test("choosing an exchange card moves the card and announces it through the real provider", async () => {
  await saveExchange();

  const view = await mount();
  await waitFor(() => expect(shown(view, "saved")).toBe("true"));

  await press(view, "resume");
  expect(shown(view, "active")).toBe("true");
  expect(shown(view, "winnerHand")).toBe("4_clubs");

  await press(view, "choose");

  expect(shown(view, "active")).toBe("false");
  expect(shown(view, "winnerHand")).toBe("");
  expect(shown(view, "loserHand")).toBe("3_spades,4_clubs");
  expect(shown(view, "turn")).toBe("1");
  expect(shown(view, "announcing")).toBe("true");
  expect(shown(view, "announceGiven")).toBe("4_clubs");

  await view.unmount();
});

// #533, reopened 2026-09-02: a residue outliving the exchange. The ceremony's
// own clock is deliberately long (`Motion.exchange.read` past the give landing),
// so a table that starts over while it is still counting down — a fresh
// match dealt here, a room rejoin online — must not carry the old exchange's
// announcement onto a felt with no record of it left. Turning `phasePresent`
// off (`useExchangeAnnouncement`, context/useExchangeAnnouncement.ts) into a no-op — read
// but never acted on — is the one-line change that reds this: `announcing`
// would then still read "true" after `setupGame`, deposed only by the timer
// this test never advances.
test("a fresh match clears the announcement outright, not on the old ceremony's clock", async () => {
  await saveExchange();

  const view = await mount();
  await waitFor(() => expect(shown(view, "saved")).toBe("true"));

  await press(view, "resume");
  await press(view, "choose");
  expect(shown(view, "announcing")).toBe("true");
  expect(shown(view, "phasePresent")).toBe("true");

  await press(view, "newMatch");

  // No fake timers, no `waitFor`: the ceremony's own clock is seconds long
  // (`exchangeAnnounceMs`), so anything left showing here is left showing by
  // the phase-driven path, not merely fast enough to have expired the timer.
  expect(shown(view, "phasePresent")).toBe("false");
  expect(shown(view, "announcing")).toBe("false");

  await view.unmount();
});

function BotWinnerProbe() {
  const { gameState, hasSavedGame, resumeGame } = useGame();
  const { onExchangeReady } = useOfflineDriver();
  return (
    <>
      <Pressable testID="resume" onPress={() => resumeGame()}>
        <Text>resume</Text>
      </Pressable>
      <Pressable testID="ready" onPress={onExchangeReady}>
        <Text>ready</Text>
      </Pressable>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="active">{String(gameState?.exchangePhase ? gameState.exchangePhase.kind === "open" : "none")}</Text>
      <Text testID="winnerHand">{gameState ? gameState.players[1].hand.map((c) => c.id).join(",") : "-"}</Text>
      <Text testID="loserHand">{gameState ? gameState.players[0].hand.map((c) => c.id).join(",") : "-"}</Text>
    </>
  );
}

// A bot loser is on move the moment the giveback lands, so a second ready would have it play over the ceremony.
for (const loser of ["human", "bot"] as const) test(`an offline bot winner gives its weakest legal card once, and only when the table is ready (${loser} loser)`, async () => {
  const ace = { id: "A_spades", suit: "spades", rank: "A", isJoker: false } as const;
  const state: GameState = {
    ...exchangeState(),
    players: [
      { ...exchangeState().players[0], type: loser, hand: [{ id: "3_clubs", suit: "clubs", rank: "3", isJoker: false }] },
      {
        id: "player_1",
        name: "Gent",
        type: "bot",
        hand: [
          ace,
          { id: "9_hearts", suit: "hearts", rank: "9", isJoker: false },
          { id: "5_hearts", suit: "hearts", rank: "5", isJoker: false },
        ],
      },
    ],
    currentTurnIndex: 1,
    exchangePhase: { kind: "open", winnerIdx: 1, loserIdx: 0, cardFromLoser: ace },
  };
  await AsyncStorage.setItem(
    OFFLINE_SAVE_KEY,
    encodeOfflineSave({
      gameState: state,
      match: { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
      dealFirstSeat: 0,
    })
  );
  const view = await render(
    <NotificationProvider>
      <GameProvider>
        <BotWinnerProbe />
      </GameProvider>
    </NotificationProvider>
  );
  await waitFor(() => expect(shown(view, "saved")).toBe("true"));
  await press(view, "resume");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, BOT_THINK_MS + 100));
  });

  expect(shown(view, "active")).toBe("true");
  expect(shown(view, "winnerHand")).toBe("A_spades,9_hearts,5_hearts");

  await press(view, "ready");
  expect(shown(view, "active")).toBe("true");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, BOT_THINK_MS + 100));
  });
  expect(shown(view, "active")).toBe("false");
  expect(shown(view, "winnerHand")).toBe("A_spades,9_hearts");
  expect(shown(view, "loserHand")).toBe("3_clubs,5_hearts");

  await press(view, "ready");
  expect(shown(view, "winnerHand")).toBe("A_spades,9_hearts");
  expect(shown(view, "loserHand")).toBe("3_clubs,5_hearts");

  await view.unmount();
});
