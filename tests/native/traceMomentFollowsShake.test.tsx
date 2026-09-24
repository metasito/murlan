import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react-native";
import { useTableFeedback } from "@/components/useTableFeedback";
import { setScreenShakeEnabled } from "@/lib/screenShake";

const mockTraceOnset = jest.fn();

jest.mock("@/lib/e2eTrace", () => ({
  ...(jest.requireActual("@/lib/e2eTrace") as object),
  traceOnset: (...args: unknown[]) => mockTraceOnset(...args),
}));
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

describe("the E2E trace records a shake's moment only when the shake fires", () => {
  beforeEach(() => {
    mockTraceOnset.mockClear();
  });
  afterEach(async () => {
    await act(async () => setScreenShakeEnabled(true));
  });

  it("records a bomb's moment with screen shake on", async () => {
    const { result, unmount } = await renderHook(() => useTableFeedback(idleState()));
    await act(async () => result.current.shake("bomb"));
    expect(momentOnsets()).toEqual([["moment", "bomb"]]);
    await unmount();
  });

  it("records nothing with screen shake off", async () => {
    await act(async () => setScreenShakeEnabled(false));
    const { result, unmount } = await renderHook(() => useTableFeedback(idleState()));
    await act(async () => result.current.shake("bomb"));
    expect(momentOnsets()).toEqual([]);
    await unmount();
  });

  it("records nothing for a tier that carries no shake", async () => {
    const { result, unmount } = await renderHook(() => useTableFeedback(idleState()));
    await act(async () => result.current.shake("ordinary"));
    expect(momentOnsets()).toEqual([]);
    await unmount();
  });
});
