// tests/native/landingHaptic.test.tsx — what a card landing feels like: the
// viewer's own play lands with a tap, a bomb rumbles in layers with the kick.
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { useTableFeedback } from "@/components/useTableFeedback";
import { hapticHeavy, hapticLight, hapticMedium, hapticRigid } from "@/lib/device/haptics";

jest.mock("@/lib/device/sounds", () => ({
  playBomb: jest.fn(),
  playCardPass: jest.fn(),
  playCardPlay: jest.fn(),
  playExchange: jest.fn(),
  playGameLose: jest.fn(),
  playGameWin: jest.fn(),
  playYourTurn: jest.fn(),
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

  it("taps lightly for the viewer's own ordinary landing", async () => {
    const { result, unmount } = await mount();
    await act(async () => {
      result.current.playImpact(false, "bottom", "pair");
    });
    expect(hapticLight).toHaveBeenCalledTimes(1);
    expect(hapticMedium).not.toHaveBeenCalled();
    await unmount();
  });

  it("taps harder for the viewer's own straight", async () => {
    const { result, unmount } = await mount();
    await act(async () => {
      result.current.playImpact(false, "bottom", "straight");
    });
    expect(hapticMedium).toHaveBeenCalledTimes(1);
    expect(hapticLight).not.toHaveBeenCalled();
    await unmount();
  });

  it("stays silent for another seat's ordinary landing", async () => {
    const { result, unmount } = await mount();
    await act(async () => {
      result.current.playImpact(false, "top", "straight");
    });
    await act(async () => {
      result.current.playImpact(false, "left", "single");
    });
    expect(hapticLight).not.toHaveBeenCalled();
    expect(hapticMedium).not.toHaveBeenCalled();
    await unmount();
  });

  it("rumbles a bomb in three layers, timed to the kick's first two jolts", async () => {
    const { result, unmount } = await mount();
    jest.useFakeTimers();
    await act(async () => {
      result.current.playImpact(true, "right", "bomb");
    });
    expect(hapticHeavy).toHaveBeenCalledTimes(1);
    expect(hapticRigid).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(255);
    });
    expect(hapticRigid).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(hapticRigid).toHaveBeenCalledTimes(1);
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
      result.current.playImpact(true, "bottom", "bomb");
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
      result.current.playImpact(false, "top", "single");
      jest.advanceTimersByTime(1000);
    });
    expect(hapticRigid).not.toHaveBeenCalled();
    expect(hapticLight).not.toHaveBeenCalled();
    await unmount();
  });

  it("drops a bomb's pending layers when the table unmounts", async () => {
    const { result, unmount } = await mount();
    jest.useFakeTimers();
    await act(async () => {
      result.current.playImpact(true, "bottom", "bomb");
    });
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(hapticRigid).not.toHaveBeenCalled();
    expect(hapticLight).not.toHaveBeenCalled();
  });
});
