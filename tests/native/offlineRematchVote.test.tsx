// tests/native/offlineRematchVote.test.tsx — who is entitled to a rematch vote
// at an offline table.
//
// The server has always let bot and vacated seats abstain from both the count
// and the total. Offline, the AI seats answered for themselves and counted
// toward the majority, so "most players agreed" meant two different things
// depending on where the player was sitting (docs/BRIEF.md §3.1).
import { test, expect } from "@jest/globals";
import React from "react";
import { Text, Pressable } from "react-native";
import { render, act, fireEvent } from "@testing-library/react-native";
import { GameProvider, useGame } from "@/context/GameContext";

const ONE_HUMAN_THREE_BOTS = [
  { name: "Ana", type: "human" as const },
  { name: "Luan", type: "ai" as const, personality: "luan" as const },
  { name: "Besnik", type: "ai" as const, personality: "besnik" as const },
  { name: "Gent", type: "ai" as const, personality: "gent" as const },
];

function Probe() {
  const { gameState, rematchTally, tableWantsRematch, setupGame, answerRematch } = useGame();
  return (
    <>
      <Pressable testID="deal" onPress={() => setupGame(ONE_HUMAN_THREE_BOTS, "free_for_all")}>
        <Text>deal</Text>
      </Pressable>
      <Pressable testID="yes" onPress={() => answerRematch(true)}>
        <Text>yes</Text>
      </Pressable>
      <Text testID="seats">{gameState ? String(gameState.players.length) : "-"}</Text>
      <Text testID="tally">{`${rematchTally.yes}/${rematchTally.total}`}</Text>
      <Text testID="verdict">{tableWantsRematch ? "again" : "stop"}</Text>
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

test("only the human seat is asked, and its yes carries the table", async () => {
  const view = await mount();
  await press(view, "deal");

  expect(shown(view, "seats")).toBe("4");
  expect(shown(view, "tally")).toBe("0/1");
  expect(shown(view, "verdict")).toBe("stop");

  await press(view, "yes");

  expect(shown(view, "tally")).toBe("1/1");
  expect(shown(view, "verdict")).toBe("again");
});
