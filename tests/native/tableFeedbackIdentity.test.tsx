// tests/native/tableFeedbackIdentity.test.tsx — what the table is handed keeps
// its identity.
//
// `GameTable` lists `playImpact` among its play effect's dependencies, so an
// identity that changes every render re-runs that effect every render. (It is
// not what stops the play being replayed — the effect's own `prevComboKeyRef`
// guard is.)
//
// This pins the property, not the change that prompted it: it passes on the
// arrangement this replaced too, and that is the point — the property has to
// survive being re-derived a fifth time by whoever fights the compiler next.
// What it will not survive is the two `useCallback`s in `useImpactFeedback`
// being dropped in favour of the React Compiler's own memoisation, which does
// not happen under jest at all: delete them and all four assertions fail.
// Compiler output is not covered here, and a correctness-adjacent property is
// not a thing to keep in an optimisation.
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
  players: [],
  isTeamMode: false,
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
