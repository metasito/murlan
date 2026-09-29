import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react-native";
import { setScreenShakeEnabled } from "@/lib/screenShake";
import { makeMutable } from "react-native-reanimated";
import type { ImpactTier } from "@/components/flightPhysics";
import { NO_LANDING } from "@/components/table/useFlightClock";
import { fireLanding, useFeedbackOnTimeline } from "./helpers/landing";

const mockTraceOnset = jest.fn();

jest.mock("@/lib/e2eTrace", () => ({
  ...(jest.requireActual("@/lib/e2eTrace") as object),
  traceOnset: (...args: unknown[]) => mockTraceOnset(...args),
}));

const idleState = () => ({
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
  viewerId: undefined,
  scale: 1,
});

const momentOnsets = () => mockTraceOnset.mock.calls.filter(([kind]) => kind === "moment");

async function mount() {
  const landing = makeMutable(NO_LANDING);
  const view = await renderHook(() => useFeedbackOnTimeline({ ...idleState(), landing }));
  await act(async () => { jest.advanceTimersByTime(16); });
  const land = (tier: ImpactTier) =>
    act(async () => {
      fireLanding(landing, { cards: 4, tier });
      jest.advanceTimersByTime(16);
    });
  return { ...view, land };
}

describe("the E2E trace records a shake's moment only when the shake fires", () => {
  beforeEach(() => {
    mockTraceOnset.mockClear();
    jest.useFakeTimers();
  });
  afterEach(async () => {
    jest.useRealTimers();
    await act(async () => setScreenShakeEnabled(true));
  });

  it("records a bomb's moment with screen shake on", async () => {
    const { land, unmount } = await mount();
    await land("bomb");
    expect(momentOnsets()).toEqual([["moment", "bomb"]]);
    await unmount();
  });

  it("records nothing with screen shake off", async () => {
    await act(async () => setScreenShakeEnabled(false));
    const { land, unmount } = await mount();
    await land("bomb");
    expect(momentOnsets()).toEqual([]);
    await unmount();
  });

  it("records nothing for a tier that carries no shake", async () => {
    const { land, unmount } = await mount();
    await land("ordinary");
    expect(momentOnsets()).toEqual([]);
    await unmount();
  });
});
