// tests/native/lampFlareReducedMotion.test.tsx — "Reduced motion lands at
// exactly zero" (#765), pinned end to end rather than trusted from the
// generic ungated-animation-block scan (tests/reducedMotion.test.ts) alone:
// that scan can only see that `Flare`/`Spark`/`LampLift` each carry a
// reduceMotion guard in their own source, not that a bomb landing under the
// setting a player actually chose never bumps the trigger those guards read.
// A separate file, not a second describe in lampFlareWiring.test.tsx: the
// preference is mocked at module scope, so the two cannot share one file.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { act, render, screen, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

jest.mock("@/lib/sounds", () => ({
  ensureAudioMode: jest.fn(async () => {}),
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

jest.mock("@/lib/accessibility", () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => "on",
}));

const boomTriggerReadings: number[] = [];
const lampLiftReadings: number[] = [];
jest.mock("@/components/useTableFeedback", () => {
  const actual: any = jest.requireActual("@/components/useTableFeedback");
  return {
    ...actual,
    useTableFeedback: (input: any) => {
      const real = actual.useTableFeedback(input);
      boomTriggerReadings.push(real.boomTrigger);
      lampLiftReadings.push(real.lampLiftTrigger);
      return real;
    },
  };
});

import { GameTable } from "@/components/GameTable";
import { impactDelayMs } from "@/components/gameTableModel";
import { getVisibleText } from "./visibilityHelpers";
import type { Card, Combination, GameState, Player } from "@/lib/gameEngine";

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
    jest.clearAllMocks();
    boomTriggerReadings.length = 0;
    lampLiftReadings.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("a bomb landing never bumps boomTrigger off zero — impactDelayMs(true) is 0, so the impact fires on the same tick", async () => {
    const r = await render(table(inPlay(BOMB_PLAY), false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(true) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(boomTriggerReadings.every((v) => v === 0)).toBe(true);

    await r.unmount();
  });

  // The flare/wave/spark are the whole of what a bomb "says" once — with the
  // trigger held at zero (above), that channel is silent for the rest of the
  // round. The combo chip on the pile is what has to carry the news instead,
  // and it is not itself gated on the preference: it is `current`'s own label,
  // drawn every time there is a combination to draw.
  it("the bomb still names itself on the pile — the label, not just the flare, survives reduced motion", async () => {
    const r = await render(table(inPlay(BOMB_PLAY), false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(true) + 10);
      jest.runOnlyPendingTimers();
    });

    const pile = within(screen.getByTestId("pile-area"));
    getVisibleText(pile, /bomb/i);

    await r.unmount();
  });

  it("the manche rung never bumps lampLiftTrigger off zero", async () => {
    const r = await render(table(HAND_CLOSED, false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(true) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(lampLiftReadings.every((v) => v === 0)).toBe(true);

    await r.unmount();
  });
});
