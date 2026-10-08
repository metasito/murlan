// tests/native/tableFeedbackIdentity.test.tsx — what the table is handed keeps
// its identity, so an effect depending on it does not re-run every render.
//
// What it will not survive is the `useCallback` in `useImpactFeedback` being
// dropped in favour of the React Compiler's own memoisation, which this
// project does not run (only `*.compiled.test.tsx` does).
import { describe, it, expect } from "@jest/globals";
import { renderHook } from "@testing-library/react-native";
import { makeMutable } from "react-native-reanimated";
import { NO_LANDING } from "@/components/table/useFlightClock";
import { useFeedbackOnTimeline } from "./helpers/landing";

const landing = makeMutable(NO_LANDING);
const state = (scale: number) => ({
  landing,
  isMyTurn: false,
  currentTurnIndex: 0,
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
  scale,
});

describe("useTableFeedback", () => {
  it("keeps rejectPlay's identity across a resize", async () => {
    const { result, rerender } = await renderHook((props: { scale: number }) => useFeedbackOnTimeline(state(props.scale)), {
      initialProps: { scale: 1 },
    });
    const first = result.current.rejectPlay;
    await rerender({ scale: 2 });
    expect(result.current.rejectPlay).toBe(first);
  });
});
