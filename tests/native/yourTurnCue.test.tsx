import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { handOffDelayMs } from "@/components/flightPhysics";
import { useTableFeedback } from "@/components/useTableFeedback";

import { bootFeedback, haptics, sounds } from "./helpers/feedback";

const turns = () => sounds().filter((s) => s === "turn").length;
const lights = () => haptics().filter((h) => h === "impactLight").length;

const PLAYED = { type: "single", cards: [], value: 3 } as any;

const state = (isMyTurn: boolean, currentTurnIndex = 0, lastPlayedCombination: any = null) => ({
  isMyTurn,
  currentTurnIndex,
  isFinished: false,
  exchangeActive: false,
  canPass: false,
  playBtnValid: false,
  selectedCount: 0,
  passCount: 0,
  lastPlayedCombination,
  roundWinner: null,
  gameOver: false,
  rankings: [],
  players: [],
  isTeamMode: false,
  handScores: {},
  viewerId: "viewer",
  scale: 1,
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
      (props: { isMyTurn: boolean }) => useTableFeedback(state(props.isMyTurn)),
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

  it("waits for the card that handed the turn over to land, and moves the lamp's seat with it", async () => {
    type P = { isMyTurn: boolean; turn: number; played: unknown };
    const { result, rerender } = await renderHook(
      (props: P) => useTableFeedback(state(props.isMyTurn, props.turn, props.played)),
      { initialProps: { isMyTurn: false, turn: 1, played: null } as P }
    );
    await rerender({ isMyTurn: true, turn: 0, played: PLAYED });
    expect(result.current.shownTurnIndex).toBe(1);
    await act(async () => jest.advanceTimersByTime(handOffDelayMs(false) - 1));
    expect(turns()).toBe(0);
    expect(result.current.shownTurnIndex).toBe(1);

    await act(async () => jest.advanceTimersByTime(1));
    expect(turns()).toBe(1);
    expect(lights()).toBe(1);
    expect(result.current.shownTurnIndex).toBe(0);
  });

  it("hands over at once on a pass, which has no landing to wait for", async () => {
    type P = { isMyTurn: boolean; turn: number };
    const { result, rerender } = await renderHook(
      (props: P) => useTableFeedback(state(props.isMyTurn, props.turn)),
      { initialProps: { isMyTurn: false, turn: 1 } }
    );
    await rerender({ isMyTurn: true, turn: 0 });
    expect(turns()).toBe(1);
    expect(result.current.shownTurnIndex).toBe(0);
  });

  it("drops a pending hand-off cue when the table unmounts", async () => {
    type P = { isMyTurn: boolean; played: unknown };
    const { rerender, unmount } = await renderHook(
      (props: P) => useTableFeedback(state(props.isMyTurn, 0, props.played)),
      { initialProps: { isMyTurn: false, played: null } as P }
    );
    await rerender({ isMyTurn: true, played: PLAYED });
    await unmount();
    await act(async () => jest.advanceTimersByTime(handOffDelayMs(false)));
    expect(turns()).toBe(0);
  });

  it("waits out a card still in flight when a pass closes the round straight after it", async () => {
    type P = { isMyTurn: boolean; turn: number; played: unknown };
    const { rerender } = await renderHook(
      (props: P) => useTableFeedback(state(props.isMyTurn, props.turn, props.played)),
      { initialProps: { isMyTurn: false, turn: 0, played: null } as P }
    );
    await rerender({ isMyTurn: false, turn: 1, played: PLAYED });
    await act(async () => jest.advanceTimersByTime(100));
    await rerender({ isMyTurn: true, turn: 0, played: null });
    await act(async () => jest.advanceTimersByTime(handOffDelayMs(false) - 101));
    expect(turns()).toBe(0);

    await act(async () => jest.advanceTimersByTime(1));
    expect(turns()).toBe(1);
  });

  it("moves the lamp when the card lands, however many passes follow it in flight", async () => {
    type P = { turn: number; played: unknown };
    const { result, rerender } = await renderHook(
      (props: P) => useTableFeedback(state(false, props.turn, props.played)),
      { initialProps: { turn: 0, played: null } as P }
    );
    await rerender({ turn: 1, played: PLAYED });
    await act(async () => jest.advanceTimersByTime(100));
    await rerender({ turn: 2, played: PLAYED });
    await act(async () => jest.advanceTimersByTime(handOffDelayMs(false) - 101));
    expect(result.current.shownTurnIndex).toBe(0);

    await act(async () => jest.advanceTimersByTime(1));
    expect(result.current.shownTurnIndex).toBe(2);
  });

  it("drops a pending hand-off cue when the manche ends before it lands", async () => {
    type P = { isMyTurn: boolean; played: unknown; gameOver: boolean };
    const { rerender } = await renderHook(
      (props: P) =>
        useTableFeedback({ ...state(props.isMyTurn, 0, props.played), gameOver: props.gameOver }),
      { initialProps: { isMyTurn: false, played: null, gameOver: false } as P }
    );
    await rerender({ isMyTurn: true, played: PLAYED, gameOver: false });
    await rerender({ isMyTurn: true, played: PLAYED, gameOver: true });
    await act(async () => jest.advanceTimersByTime(handOffDelayMs(false)));
    expect(turns()).toBe(0);
  });
});
