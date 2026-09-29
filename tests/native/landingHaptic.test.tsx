// tests/native/landingHaptic.test.tsx — what a card landing feels like: the viewer's own play
// lands with a tap, a bomb rumbles in layers with the kick. The pulses start from the landing
// signal (landingOnContact.test.tsx pins its frame); the sound is the timeline's (oneEventPerCommit).
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { makeMutable } from "react-native-reanimated";
import { KICK_JOLTS } from "@/components/useTableFeedback";
import { LANDING_PULSES } from "@/lib/device/feedback";
import { NO_LANDING } from "@/components/table/useFlightClock";
import type { FlyDirection } from "@/components/seatLayout";
import { bootFeedback, haptics, settle } from "./helpers/feedback";
import { fireLanding, useFeedbackOnTimeline } from "./helpers/landing";

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

async function mount() {
  const landing = makeMutable(NO_LANDING);
  const view = await renderHook(() => useFeedbackOnTimeline({ ...state, landing }));
  const land = (cards: number, heavy: boolean, dir: FlyDirection) =>
    act(async () => {
      fireLanding(landing, { cards, heavy, mine: dir === "bottom" });
    });
  return { ...view, land };
}

describe("a card landing's haptic", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("taps lightly for the viewer's own single card", async () => {
    const { land, unmount } = await mount();
    await land(1, false, "bottom");
    await settle(16);
    expect(haptics()).toEqual(["impactLight"]);
    await unmount();
  });

  it("taps harder for any of the viewer's own combos", async () => {
    const { land, unmount } = await mount();
    await land(2, false, "bottom");
    await settle(16);
    expect(haptics()).toEqual(["impactMedium"]);
    await unmount();
  });

  it("stays silent in the hand for another seat's ordinary landing", async () => {
    const { land, unmount } = await mount();
    await land(5, false, "top");
    await settle(500);
    await land(1, false, "left");
    await settle(16);
    expect(haptics()).toEqual([]);
    await unmount();
  });

  it("times a bomb's later layers to the kick's first two jolts", () => {
    const [, heavy, light] = LANDING_PULSES.bomb;
    expect(heavy.offsetMs).toBe(KICK_JOLTS[0].ms);
    expect(light.offsetMs).toBe(KICK_JOLTS[0].ms + KICK_JOLTS[1].ms);
  });

  it("rumbles another seat's bomb in three layers: rigid on impact, then heavy, then light", async () => {
    const { land, unmount } = await mount();
    await land(4, true, "right");
    await settle(16);
    expect(haptics()).toEqual(["rigid"]);
    await settle(LANDING_PULSES.bomb[2].offsetMs);
    expect(haptics()).toEqual(["rigid", "impactHeavy", "impactLight"]);
    await unmount();
  });

  it("drops a bomb's pending layers when the next card lands first", async () => {
    const { land, unmount } = await mount();
    await land(4, true, "bottom");
    await settle(100);
    await land(1, false, "top");
    await settle(1000);
    expect(haptics()).toEqual(["rigid"]);
    await unmount();
  });

  it("drops a bomb's pending layers when the table unmounts", async () => {
    const { land, unmount } = await mount();
    await land(4, true, "bottom");
    await settle(16);
    await unmount();
    await settle(1000);
    expect(haptics()).toEqual(["rigid"]);
  });
});
