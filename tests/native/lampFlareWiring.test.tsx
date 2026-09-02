// tests/native/lampFlareWiring.test.tsx — the lamp's flare and lift (#765),
// mounted rather than grepped: #764's own lesson was that a source scan
// cannot tell a dead function from a reachable one. `burst` is spied the same
// way tests/native/onlinePartitaShake.test.tsx already spies `shake` — a real
// mount, a real landing timeout, a real call into the hook's own exposed
// function, so a `burst` nobody actually calls fails this exactly as loudly
// as a `burst` called with the wrong tier. `shake` is spied alongside it into
// the one `feedbackCallLog`, so the last test can assert they fire for the
// same tier in the same landing rather than trusting two independent spies
// to agree by construction.
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { act, render } from "@testing-library/react-native";
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

// Real timing: the whole point is the window between the play landing and
// the impact firing.
jest.mock("@/lib/accessibility", () => ({
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => "off",
}));

const mockBurstCalls: string[] = [];
/**
 * `shake` and `burst` recorded into one shared, ordered log — not two
 * separate ones — so "did both fire for the same landing" is answerable from
 * a single array rather than two arrays a reader has to line up by hand.
 */
const feedbackCallLog: { fn: "shake" | "burst"; tier: string }[] = [];
jest.mock("@/components/useTableFeedback", () => {
  const actual: any = jest.requireActual("@/components/useTableFeedback");
  return {
    ...actual,
    useTableFeedback: (input: any) => {
      const real = actual.useTableFeedback(input);
      return {
        ...real,
        shake: (tier: any) => {
          feedbackCallLog.push({ fn: "shake", tier });
          return real.shake(tier);
        },
        burst: (tier: any) => {
          mockBurstCalls.push(tier);
          feedbackCallLog.push({ fn: "burst", tier });
          return real.burst(tier);
        },
      };
    },
  };
});

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

describe("the lamp's flare and lift, wired off the same tier the shake reads (#765)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBurstCalls.length = 0;
    feedbackCallLog.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("a bomb landing bursts as 'bomb'", async () => {
    const r = await render(table(inPlay(BOMB_PLAY), false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(mockBurstCalls).toContain("bomb");

    await r.unmount();
  });

  it("a straight or flush lands at its own tier and never bursts as a bomb", async () => {
    const r = await render(table(inPlay(ROYAL_PLAY), false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(mockBurstCalls).toContain("straightFlush");
    expect(mockBurstCalls).not.toContain("bomb");

    await r.unmount();
  });

  it("the manche rung bursts as 'mancheWon' — the lamp lifts, never flares, for this one", async () => {
    const r = await render(table(HAND_CLOSED, false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(mockBurstCalls).toContain("mancheWon");
    expect(mockBurstCalls).not.toContain("partitaWon");

    await r.unmount();
  });

  it("the partita rung bursts as 'partitaWon' when the match closed with the hand", async () => {
    const r = await render(table(HAND_CLOSED, false));

    // `game:over` lands a render later, matchOver flips with the same
    // gameState — the pile effect's own key guard skips re-scheduling.
    await act(async () => r.rerender(table(HAND_CLOSED, true)));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(mockBurstCalls).toContain("partitaWon");
    expect(mockBurstCalls).not.toContain("mancheWon");

    await r.unmount();
  });

  it("burst fires in the same tick shake does, for the same landing — not merely the same tier eventually", async () => {
    // A second blind critique on this exact test caught it not testing what
    // it claimed: `runOnlyPendingTimers()` after the advance flushes every
    // timer pending at that point, including one a decoupled `burst` might
    // be hiding behind (`setTimeout(() => burst(tier), 400)` inside the
    // landing callback) — so it would still pass. Advancing to exactly the
    // landing's own timeout, with nothing further flushed, is what actually
    // pins the tick: a `burst` behind its own timer has not fired yet at
    // that instant, only `shake` has.
    //
    // The partita rung is the one scenario in this file where a *tier*
    // mismatch is also observable (`matchOver` flips mid-test, below), so
    // this doubles as the #764-style decoupling check the tier-only version
    // of this test used to be.
    const r = await render(table(HAND_CLOSED, false));
    await act(async () => r.rerender(table(HAND_CLOSED, true)));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false));
    });

    expect(feedbackCallLog).toEqual([
      { fn: "shake", tier: "partitaWon" },
      { fn: "burst", tier: "partitaWon" },
    ]);

    // Only now flush whatever else the landing may have scheduled (sounds,
    // duck timers) — the assertion above already ran against the exact tick.
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    await r.unmount();
  });
});
