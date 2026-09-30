import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { act, render, renderHook } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { makeMutable } from "react-native-reanimated";
import { NO_LANDING } from "@/components/table/useFlightClock";
import { Hold } from "@/lib/tokens";
import type { Combination } from "@/lib/game/gameEngine";
import { bootFeedback, ctxAt, haptics, sounds, startsOf } from "./helpers/feedback";
import { card, farthest, frameOfFirst, PAIR, tableAfter, throwPair, useFeedbackOnTimeline } from "./helpers/landing";

const SINGLE: Combination = { type: "single", cards: [card("c", "4", "hearts")], strength: 4 };

const turns = () => sounds().filter((s) => s === "turn").length;
const lights = () => haptics().filter((h) => h === "impactLight").length;

const landing = makeMutable(NO_LANDING);

const state = (isMyTurn: boolean, currentTurnIndex = 0) => ({
  isMyTurn,
  currentTurnIndex,
  isFinished: false,
  exchangeActive: false,
  canPass: false,
  passCount: 0,
  lastPlayedCombination: null,
  roundWinner: null,
  gameOver: false,
  rankings: [],
  players: [],
  isTeamMode: false,
  handScores: {},
  viewerId: "viewer",
  scale: 1,
  landing,
});

describe("the turn-arrival cue", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fires the haptic alongside the sound, once, on the edge into the viewer's turn", async () => {
    const { rerender } = await renderHook(
      (props: { isMyTurn: boolean }) => useFeedbackOnTimeline(state(props.isMyTurn)),
      { initialProps: { isMyTurn: false } }
    );
    expect(turns()).toBe(0);
    expect(lights()).toBe(0);

    await rerender({ isMyTurn: true });
    expect(turns()).toBe(1);
    expect(lights()).toBe(1);

    // Staying on the viewer's turn across a re-render must not repeat either.
    await rerender({ isMyTurn: true });
    expect(turns()).toBe(1);
    expect(lights()).toBe(1);
  });

  it("hands over at once on a pass, which has no landing to wait for", async () => {
    type P = { isMyTurn: boolean; turn: number };
    const { result, rerender } = await renderHook(
      (props: P) => useFeedbackOnTimeline(state(props.isMyTurn, props.turn)),
      { initialProps: { isMyTurn: false, turn: 1 } }
    );
    await rerender({ isMyTurn: true, turn: 0 });
    expect(turns()).toBe(1);
    expect(result.current.shownTurnIndex).toBe(0);
  });

  it("sounds the turn a hold after the card that handed it over comes to rest, and nothing before its first frame", async () => {
    const view = await throwPair();
    expect(startsOf("turn")).toEqual([]);
    const { frame, now } = await frameOfFirst(view, () => farthest(view) === 0);
    expect(startsOf("turn")).toHaveLength(1);
    expect(Math.abs(startsOf("turn")[0] - ctxAt(now[frame] + Hold.land))).toBeLessThanOrEqual(0.017);
    await view.unmount();
  });

  it("keeps the seats on the thrower until the card that handed the turn over has come to rest", async () => {
    const view = await render(tableAfter({ by: 3, combo: PAIR, turn: 1 }));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    const topLit = () => StyleSheet.flatten(view.getByTestId("top-seat").props.style).opacity === undefined;
    expect(topLit()).toBe(false);
    await act(async () => view.rerender(tableAfter({ by: 1, combo: SINGLE, turn: 2 })));
    expect(topLit()).toBe(false);
    const { frame, drawn } = await frameOfFirst(view, topLit);
    expect(drawn[0]).toBeGreaterThan(1);
    expect(drawn[frame]).toBe(0);
    await view.unmount();
  });
});
