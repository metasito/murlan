// tests/native/lampFlareWiring.test.tsx — the lamp's flare and lift (#765),
// mounted rather than grepped: the tier a real landing writes onto the one
// signal the shake, the burst and the lift all react to, on its contact frame.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { act, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

jest.mock("@/lib/accessibility", () => ({
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => "off",
}));

const mockLanding: { current: { value: { seq: number; tier: string } } | null } = { current: null };
jest.mock("@/components/useTableFeedback", () => {
  const actual: any = jest.requireActual("@/components/useTableFeedback");
  return {
    ...actual,
    useTableFeedback: (input: any) => {
      mockLanding.current = input.landing;
      return actual.useTableFeedback(input);
    },
  };
});

import { GameTable } from "@/components/GameTable";
import { frameOfFirst } from "./helpers/landing";
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
const ROYAL_CARD: Card = { id: "10_hearts", rank: "10", suit: "hearts", isJoker: false };
const ROYAL_PLAY: Combination = { type: "royal_straight", cards: [ROYAL_CARD], strength: 10 };
const SINGLE_CARD: Card = { id: "K_hearts", rank: "K", suit: "hearts", isJoker: false };
const WINNING_PLAY: Combination = { type: "single", cards: [SINGLE_CARD], strength: 13 };

const noop = () => {};
const table = (gameState: GameState, matchOver: boolean) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      matchOver={matchOver}
      viewerSeat={1}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const players: Player[] = [seat("player_0", "Ana"), seat("player_1", "Besi")];

/** A play that lands without closing anything — the round stays open. */
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

/** The one landing `state` writes, read on the frame it is written. */
async function landingOf(state: GameState, matchOver = false) {
  const r = await render(table(state, false));
  // `game:over` lands a render later: matchOver flips with the same gameState, mid-flight.
  if (matchOver) await act(async () => r.rerender(table(state, true)));
  const { frame, drawn } = await frameOfFirst(r, () => mockLanding.current!.value.seq > 0);
  expect(drawn[frame]).toBeLessThanOrEqual(1);
  expect(drawn[frame - 1]).toBeGreaterThan(1);
  const { seq, tier } = mockLanding.current!.value;
  await r.unmount();
  return { seq, tier };
}

describe("the lamp's flare and lift, wired off the same tier the shake reads (#765)", () => {
  beforeEach(() => {
    mockLanding.current = null;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each<[string, GameState, boolean, string]>([
    ["a bomb", inPlay(BOMB_PLAY), false, "bomb"],
    ["a straight or flush", inPlay(ROYAL_PLAY), false, "straightFlush"],
    ["the manche rung", HAND_CLOSED, false, "mancheWon"],
    ["the partita rung, when the match closed with the hand", HAND_CLOSED, true, "partitaWon"],
  ])("%s lands once, as its own tier", async (_, state, matchOver, tier) => {
    expect(await landingOf(state, matchOver)).toEqual({ seq: 1, tier });
  });
});
