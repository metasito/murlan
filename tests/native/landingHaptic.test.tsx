// tests/native/landingHaptic.test.tsx — what a card landing feels like: the
// viewer's own play lands with a tap, a bomb rumbles in layers with the kick.
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { KICK_JOLTS, useTableFeedback } from "@/components/useTableFeedback";
import { LANDING_PULSES } from "@/lib/device/feedback";
import { bootFeedback, haptics, settle, sounds } from "./helpers/feedback";

const state = {
  isMyTurn: false,
  currentTurnIndex: 0,
  isFinished: false,
  exchangeActive: false,
  canPass: false,
  playBtnValid: false,
  selectedCount: 0,
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
};

const mount = () => renderHook(() => useTableFeedback(state));

describe("a card landing's haptic", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("taps lightly for the viewer's own single card", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(false, "bottom", 1));
    await settle();
    expect(sounds()).toEqual(["play"]);
    expect(haptics()).toEqual(["impactLight"]);
    await unmount();
  });

  it("taps harder for any of the viewer's own combos, with the combo sound", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(false, "bottom", 2));
    await settle();
    expect(sounds()).toEqual(["combo"]);
    expect(haptics()).toEqual(["impactMedium"]);
    await unmount();
  });

  it("stays silent in the hand for another seat's ordinary landing", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(false, "top", 5));
    await settle(500);
    await act(async () => result.current.playImpact(false, "left", 1));
    await settle();
    expect(sounds()).toEqual(["combo", "play"]);
    expect(haptics()).toEqual([]);
    await unmount();
  });

  it("times a bomb's later layers to the kick's first two jolts", () => {
    const [, heavy, light] = LANDING_PULSES.bomb;
    expect(heavy.offsetMs).toBe(KICK_JOLTS[0].ms);
    expect(light.offsetMs).toBe(KICK_JOLTS[0].ms + KICK_JOLTS[1].ms);
  });

  it("rumbles a bomb in three layers: rigid on impact, then heavy, then light", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(true, "right", 4));
    await settle();
    expect(sounds()).toEqual(["bomb"]);
    expect(haptics()).toEqual(["rigid"]);
    await settle(255);
    expect(haptics()).toEqual(["rigid"]);
    await settle(1);
    expect(haptics()).toEqual(["rigid", "impactHeavy"]);
    await settle(159);
    expect(haptics()).toEqual(["rigid", "impactHeavy"]);
    await settle(1);
    expect(haptics()).toEqual(["rigid", "impactHeavy", "impactLight"]);
    await unmount();
  });

  it("drops a bomb's pending layers when the next card lands first", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(true, "bottom", 4));
    await settle(100);
    await act(async () => result.current.playImpact(false, "top", 1));
    await settle(1000);
    expect(haptics()).toEqual(["rigid"]);
    await unmount();
  });

  it("drops a bomb's pending layers when the table unmounts", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(true, "bottom", 4));
    await settle();
    await unmount();
    await settle(1000);
    expect(haptics()).toEqual(["rigid"]);
  });
});
