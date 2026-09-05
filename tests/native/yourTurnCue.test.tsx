import { describe, it, expect, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react-native";
import { useTableFeedback } from "@/components/useTableFeedback";

jest.mock("@/lib/sounds", () => ({
  playBomb: jest.fn(),
  playCardPass: jest.fn(),
  playCardPlay: jest.fn(),
  playExchange: jest.fn(),
  playGameLose: jest.fn(),
  playGameWin: jest.fn(),
  playYourTurn: jest.fn(),
}));
jest.mock("@/lib/haptics", () => ({
  hapticHeavy: jest.fn(),
  hapticLight: jest.fn(),
  hapticSuccess: jest.fn(),
  hapticWarn: jest.fn(),
}));
jest.mock("@/lib/music", () => ({ cancelMusicDuck: jest.fn(), duckMusicFor: jest.fn() }));

import { playYourTurn } from "@/lib/sounds";
import { hapticLight } from "@/lib/haptics";

const state = (isMyTurn: boolean) => ({
  isMyTurn,
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
});

describe("the turn-arrival cue", () => {
  it("fires the haptic alongside the sound, once, on the edge into the viewer's turn", async () => {
    const { rerender } = await renderHook(
      (props: { isMyTurn: boolean }) => useTableFeedback(state(props.isMyTurn)),
      { initialProps: { isMyTurn: false } }
    );
    expect(playYourTurn).not.toHaveBeenCalled();
    expect(hapticLight).not.toHaveBeenCalled();

    await rerender({ isMyTurn: true });
    expect(playYourTurn).toHaveBeenCalledTimes(1);
    expect(hapticLight).toHaveBeenCalledTimes(1);

    // Staying on the viewer's turn across a re-render must not repeat either.
    await rerender({ isMyTurn: true });
    expect(playYourTurn).toHaveBeenCalledTimes(1);
    expect(hapticLight).toHaveBeenCalledTimes(1);
  });
});
