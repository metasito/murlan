// tests/native/landingHaptic.test.tsx — what a card landing feels like: the
// viewer's own play lands with a tap, a bomb rumbles in layers with the kick.
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { KICK_JOLTS, useTableFeedback } from "@/components/useTableFeedback";
import { cueFor } from "@/lib/device/cues";
import { hapticHeavy, hapticLight, hapticMedium, hapticRigid } from "@/lib/device/haptics";
import { playBomb, playCardPlay, playCombo } from "@/lib/device/sounds";

jest.mock("@/lib/device/sounds", () => ({
  playBomb: jest.fn(),
  playCardPass: jest.fn(),
  playCardPlay: jest.fn(),
  playCombo: jest.fn(),
  playExchange: jest.fn(),
  playMancheLost: jest.fn(),
  playMancheWon: jest.fn(),
  playTurn: jest.fn(),
}));
jest.mock("@/lib/device/haptics", () => ({
  hapticHeavy: jest.fn(),
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticRigid: jest.fn(),
  hapticSuccess: jest.fn(),
  hapticWarn: jest.fn(),
}));
jest.mock("@/lib/device/music", () => ({ cancelMusicDuck: jest.fn(), duckMusicFor: jest.fn() }));

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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("taps lightly for the viewer's own single card", async () => {
    const { result, unmount } = await mount();
    await act(async () => {
      result.current.playImpact(false, "bottom", 1);
    });
    expect(playCardPlay).toHaveBeenCalledTimes(1);
    expect(hapticLight).toHaveBeenCalledTimes(1);
    expect(hapticMedium).not.toHaveBeenCalled();
    await unmount();
  });

  it("taps harder for any of the viewer's own combos, with the combo sound", async () => {
    const { result, unmount } = await mount();
    await act(async () => {
      result.current.playImpact(false, "bottom", 2);
    });
    expect(playCombo).toHaveBeenCalledTimes(1);
    expect(playCardPlay).not.toHaveBeenCalled();
    expect(hapticMedium).toHaveBeenCalledTimes(1);
    expect(hapticLight).not.toHaveBeenCalled();
    await unmount();
  });

  it("stays silent in the hand for another seat's ordinary landing", async () => {
    const { result, unmount } = await mount();
    await act(async () => {
      result.current.playImpact(false, "top", 5);
    });
    await act(async () => {
      result.current.playImpact(false, "left", 1);
    });
    expect(playCombo).toHaveBeenCalledTimes(1);
    expect(playCardPlay).toHaveBeenCalledTimes(1);
    expect(hapticLight).not.toHaveBeenCalled();
    expect(hapticMedium).not.toHaveBeenCalled();
    await unmount();
  });

  it("times a bomb's later layers to the kick's first two jolts", () => {
    const [, heavy, light] = cueFor({ kind: "landing", cards: 4, bomb: true, mine: false }).haptics;
    expect(heavy.atMs).toBe(KICK_JOLTS[0].ms);
    expect(light.atMs).toBe(KICK_JOLTS[0].ms + KICK_JOLTS[1].ms);
  });

  it("rumbles a bomb in three layers: rigid on impact, then heavy, then light", async () => {
    const { result, unmount } = await mount();
    jest.useFakeTimers();
    await act(async () => {
      result.current.playImpact(true, "right", 4);
    });
    expect(playBomb).toHaveBeenCalledTimes(1);
    expect(hapticRigid).toHaveBeenCalledTimes(1);
    expect(hapticHeavy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(255);
    });
    expect(hapticHeavy).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(hapticHeavy).toHaveBeenCalledTimes(1);
    expect(hapticLight).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(159);
    });
    expect(hapticLight).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(hapticLight).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("drops a bomb's pending layers when the next card lands first", async () => {
    const { result, unmount } = await mount();
    jest.useFakeTimers();
    await act(async () => {
      result.current.playImpact(true, "bottom", 4);
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
      result.current.playImpact(false, "top", 1);
      jest.advanceTimersByTime(1000);
    });
    expect(hapticHeavy).not.toHaveBeenCalled();
    expect(hapticLight).not.toHaveBeenCalled();
    await unmount();
  });

  it("drops a bomb's pending layers when the table unmounts", async () => {
    const { result, unmount } = await mount();
    jest.useFakeTimers();
    await act(async () => {
      result.current.playImpact(true, "bottom", 4);
    });
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(hapticHeavy).not.toHaveBeenCalled();
    expect(hapticLight).not.toHaveBeenCalled();
  });
});
