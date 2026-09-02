// tests/native/lampFlareEndToEnd.test.tsx — a second blind critique on #765
// found that neither the wiring tests (tests/native/lampFlareWiring.test.tsx)
// nor the visible-value tests (tests/native/bombBurstAnimatesVisibly.test.tsx)
// actually connect `GameTable.tsx`'s own JSX to what the hook produces: the
// wiring tests spy on `useTableFeedback`'s `burst(tier)` call, and the
// visible-value tests mount `BombBurst`/`LampLift` directly with a hardcoded
// `trigger={1}`. Hardcoding `trigger={0}` on both in `GameTable.tsx` — so the
// feature never fires in the real app — passed all of them.
//
// This file does neither: `useTableFeedback` is not mocked at all, `GameTable`
// is mounted for real, a play lands for real, and the animated style is read
// back off the real rendered `bomb-flare`/`spark-0`/`lamp-lift` nodes the way
// tests/native/pileFlinch.test.tsx reads a rendered transform — the one path
// a hardcoded trigger literal in GameTable's own JSX cannot survive.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { act, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getAnimatedStyle } from "react-native-reanimated";

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
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => "off",
}));

import { GameTable } from "@/components/GameTable";
import { impactDelayMs } from "@/components/gameTableModel";
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

/**
 * `LampLift` lives inside `table-felt` (`components/GameTable.tsx`), which
 * carries `a11yHidden()`'s `importantForAccessibility="no-hide-descendants"`
 * — the felt is decoration, read by nothing assistive. `getByTestId` excludes
 * a subtree marked that way by default (`isHiddenFromAccessibility`,
 * `@testing-library/react-native`'s own `helpers/accessibility.js`), so a
 * plain query reports "unable to find" for a node `toJSON()` shows is really
 * there. `includeHiddenElements: true` is the query option built for exactly
 * this — a real node, correctly hidden from screen readers, not absent.
 */
function opacityOf(
  r: { getByTestId: (id: string, opts?: { includeHiddenElements?: boolean }) => unknown },
  testID: string
): number {
  const node = r.getByTestId(testID, { includeHiddenElements: true });
  const style = getAnimatedStyle(node) as { opacity?: number };
  return style.opacity ?? 0;
}

describe("the lamp's flare and lift, read back off GameTable's own real render (#765)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("a bomb landing visibly flares and sparks through GameTable's own wiring, not a mock of it", async () => {
    const r = await render(table(inPlay(BOMB_PLAY), false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 1);
    });
    // Solidly inside the flare's first leg and past spark 0's own lead delay
    // (60ms) — see tests/native/bombBurstAnimatesVisibly.test.tsx.
    await act(async () => {
      jest.advanceTimersByTime(90);
    });

    expect(opacityOf(r, "bomb-flare")).toBeGreaterThan(0);
    expect(opacityOf(r, "spark-0")).toBeGreaterThan(0);

    await r.unmount();
  });

  it("the manche rung visibly lifts the lamp through GameTable's own wiring, not a mock of it", async () => {
    const r = await render(table(HAND_CLOSED, false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 1);
    });
    // Partway through the lift's own 900ms window — see
    // tests/native/bombBurstAnimatesVisibly.test.tsx. No `runOnlyPendingTimers`
    // here: it would flush the whole `withSequence` to its own end, landing
    // back at rest (opacity 0) rather than mid-pulse.
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    expect(opacityOf(r, "lamp-lift")).toBeGreaterThan(0);

    await r.unmount();
  });
});
