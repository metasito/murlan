// tests/native/gameContextExchange.test.tsx — choosing an exchange card,
// exercised through the real GameProvider rather than a mock.
//
// GameContext used to read the live game state through a ref written during
// render (issue #36); this drives `chooseExchangeCard` the way a player does —
// through `useGame()` — so a regression that reverts to a stale read would
// show up as a wrong hand or a missing announcement here, not just as a
// compiler bailout.
import { test, expect } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GameProvider, useGame } from "@/context/GameContext";
import { encodeOfflineSave, OFFLINE_SAVE_KEY } from "@/lib/offlineSave";
import type { GameState } from "@/lib/gameEngine";

/**
 * A hand parked mid-exchange: the human (seat 0) won the round and owes seat
 * 1 a giveback. `4_clubs` is the only card in the winner's hand that the
 * exchange rules (docs/RULES.md §10) allow to be handed back.
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
        type: "ai",
        hand: [{ id: "3_spades", suit: "spades", rank: "3", isJoker: false }],
      },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    exchangePhase: {
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: { id: "3_spades", suit: "spades", rank: "3", isJoker: false },
      bothJokersException: false,
    },
  };
}

function Probe() {
  const {
    gameState,
    exchangeAnnouncing,
    exchangeAnnounceData,
    hasSavedGame,
    resumeGame,
    chooseExchangeCard,
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
      <Pressable
        testID="newMatch"
        onPress={() =>
          setupGame(
            [
              { name: "Ana", type: "human" },
              { name: "Gent", type: "ai" },
            ],
            "free_for_all"
          )
        }
      >
        <Text>new match</Text>
      </Pressable>
      <Text testID="saved">{String(hasSavedGame)}</Text>
      <Text testID="active">{String(gameState?.exchangePhase?.active ?? "none")}</Text>
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
    <GameProvider>
      <Probe />
    </GameProvider>
  );

type View = Awaited<ReturnType<typeof mount>>;

const press = async (view: View, id: string) => {
  await act(async () => {
    fireEvent.press(view.getByTestId(id));
  });
};

const shown = (view: View, id: string) => view.getByTestId(id).props.children;

test("choosing an exchange card moves the card and announces it through the real provider", async () => {
  await AsyncStorage.setItem(
    OFFLINE_SAVE_KEY,
    encodeOfflineSave({
      gameState: exchangeState(),
      match: { length: "match", target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false },
      rematchAnswers: {},
      players: [
        { name: "Ana", type: "human" },
        { name: "Gent", type: "ai" },
      ],
      gameMode: "free_for_all",
      dealFirstSeat: 0,
    })
  );

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
// own reading clock is deliberately long (`Reading.notice` past the flight),
// so a table that starts over while it is still counting down — a fresh
// match dealt here, a room rejoin online — must not carry the old trade's
// announcement onto a felt with no record of it left. Turning `phasePresent`
// off (`useExchangeAnnouncement`, lib/sharedGameFlow.ts) into a no-op — read
// but never acted on — is the one-line change that reds this: `announcing`
// would then still read "true" after `setupGame`, deposed only by the timer
// this test never advances.
test("a fresh match clears the announcement outright, not on the old ceremony's clock", async () => {
  await AsyncStorage.setItem(
    OFFLINE_SAVE_KEY,
    encodeOfflineSave({
      gameState: exchangeState(),
      match: { length: "match", target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false },
      rematchAnswers: {},
      players: [
        { name: "Ana", type: "human" },
        { name: "Gent", type: "ai" },
      ],
      gameMode: "free_for_all",
      dealFirstSeat: 0,
    })
  );

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
