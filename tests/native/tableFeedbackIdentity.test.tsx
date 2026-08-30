// tests/native/tableFeedbackIdentity.test.tsx — playImpact survives a resize.
//
// GameTable lists `playImpact` as a dependency of its play effect, so a new
// identity on every render re-runs the play on every rotation and resize. It
// used to be a `useCallback` reading `scale` through a ref; it is now a plain
// closure that the React Compiler memoises, which is only equivalent while the
// file actually compiles — `tests/reactCompiler.test.ts` is what keeps it doing
// so, and this is what says the memoisation is really there.
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
  hapticSuccess: jest.fn(),
  hapticWarn: jest.fn(),
}));
jest.mock("@/lib/music", () => ({ cancelMusicDuck: jest.fn(), duckMusicFor: jest.fn() }));

const state = (scale: number) => ({
  isMyTurn: false,
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
  viewerId: "viewer",
  scale,
});

describe("useTableFeedback", () => {
  it("keeps playImpact's identity across a resize", async () => {
    const { result, rerender } = await renderHook((props: { scale: number }) => useTableFeedback(state(props.scale)), {
      initialProps: { scale: 1 },
    });
    const first = result.current.playImpact;

    await rerender({ scale: 1.4 });
    expect(result.current.playImpact).toBe(first);

    await rerender({ scale: 1.4 });
    expect(result.current.playImpact).toBe(first);
  });

  it("keeps rejectPlay's identity too", async () => {
    const { result, rerender } = await renderHook((props: { scale: number }) => useTableFeedback(state(props.scale)), {
      initialProps: { scale: 1 },
    });
    const first = result.current.rejectPlay;
    await rerender({ scale: 2 });
    expect(result.current.rejectPlay).toBe(first);
  });
});
