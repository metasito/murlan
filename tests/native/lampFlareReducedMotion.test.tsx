// tests/native/lampFlareReducedMotion.test.tsx — "Reduced motion lands at
// exactly zero" (#765), pinned end to end rather than trusted from the
// generic ungated-animation-block scan (tests/ui-rules/reducedMotion.test.ts) alone:
// that scan can only see that `Flare`/`LampLift` each carry a
// reduceMotion guard in their own source, not that a bomb landing under the
// setting a player actually chose leaves what they draw at rest.
// A separate file, not a second describe in lampFlareWiring.test.tsx: the
// preference is mocked at module scope, so the two cannot share one file.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { act, render, screen, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

jest.mock("@/lib/accessibility", () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => "on",
}));

import { getAnimatedStyle } from "react-native-reanimated";
import { GameTable } from "@/components/GameTable";
import type { Card, Combination, GameState, Player } from "@/lib/game/gameEngine";

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: "human" });
const BOMB_CARD: Card = { id: "8_hearts", rank: "8", suit: "hearts", isJoker: false };
const BOMB_PLAY: Combination = {
  type: "bomb",
  cards: [
    BOMB_CARD,
    { id: "8_clubs", rank: "8", suit: "clubs", isJoker: false },
    { id: "8_spades", rank: "8", suit: "spades", isJoker: false },
    { id: "8_diamonds", rank: "8", suit: "diamonds", isJoker: false },
  ],
  strength: 8,
};
const SINGLE_CARD: Card = { id: "K_hearts", rank: "K", suit: "hearts", isJoker: false };
const WINNING_PLAY: Combination = { type: "single", cards: [SINGLE_CARD], strength: 13 };

const noop = () => {};
/** #1259 Q1: a mark enters in the mockup's 100 ms; under reduced motion the fade stays. */
const MARK_ENTER_MS = 100;
const opacityOf = (testID: string) =>
  (getAnimatedStyle(screen.getByTestId(testID, { includeHiddenElements: true })) as { opacity?: number }).opacity ?? 0;
const table = (gameState: GameState, matchOver: boolean) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      matchOver={matchOver}
      viewerSeat={1}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const players: Player[] = [seat("player_0", "Ana"), seat("player_1", "Besi")];

const inPlay = (combo: Combination): GameState => ({
  players,
  currentTurnIndex: 0,
  lastPlayedCombination: combo,
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: "free_for_all",
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

/** The hand-emptying play that closed it, exactly as `game:state` reports it. */
const HAND_CLOSED: GameState = {
  players,
  currentTurnIndex: 0,
  lastPlayedCombination: WINNING_PLAY,
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: "free_for_all",
  roundWinner: null,
  gameOver: true,
  rankings: ["player_1", "player_0"],
  firstPlayMade: true,
};

describe("reduced motion holds the lamp's flare and lift at exactly zero (#765)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("a bomb landing leaves the flare and the flash dark", async () => {
    const r = await render(table(inPlay(BOMB_PLAY), false));

    let flare = 0;
    let flash = 0;
    for (let f = 0; f < 32; f++) {
      await act(async () => {
        jest.advanceTimersByTime(16);
      });
      flare = Math.max(flare, opacityOf("bomb-flare"));
      flash = Math.max(flash, opacityOf("bomb-flash"));
    }

    expect(flare).toBe(0);
    expect(flash).toBe(0);

    await r.unmount();
  });

  // The flare/wave/spark are the whole of what a bomb "says" once — with the
  // burst held dark (above), that channel is silent for the rest of the
  // round. The combo chip on the pile is what has to carry the news instead,
  // and it is not itself gated on the preference: it is `current`'s own label,
  // drawn every time there is a combination to draw.
  it("the bomb still names itself on the pile — the label, not just the flare, survives reduced motion", async () => {
    const r = await render(table(inPlay(BOMB_PLAY), false));

    for (let f = 0; f < 6; f++) {
      await act(async () => {
        jest.advanceTimersByTime(16);
      });
    }

    await act(async () => {
      jest.advanceTimersByTime(MARK_ENTER_MS);
    });
    const mark = within(screen.getByTestId("pile-area")).getByTestId("notice-combo", { includeHiddenElements: true });
    within(mark).getByText(/bomb/i, { includeHiddenElements: true });
    expect((getAnimatedStyle(mark) as { opacity?: number }).opacity).toBe(1);

    await r.unmount();
  });

  it("the manche rung leaves the lamp lift dark", async () => {
    const r = await render(table(HAND_CLOSED, false));

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    expect(opacityOf("lamp-lift")).toBe(0);

    await r.unmount();
  });
});
