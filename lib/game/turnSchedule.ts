import { actingSeat, openingIsPending, type GameState } from "./gameEngine.ts";

export type TableKind = "online" | "offline";

/** What the table shows before the seat on move may act, in the order it shows them. */
export type Gate = "deal" | "receive" | "ceremony" | "opening";

export type TurnAction = "give" | "lead" | "follow";

export interface TurnPolicy {
  /** A human on move here is under a deadline. */
  timed: boolean;
  /** A bot on move here waits `BOT_THINK_MS` once the gates are past. */
  thinks: boolean;
}

/** docs/GAME-RULES.md § Decisions, "The turn clock". */
export const TURN_POLICY: Readonly<Record<TableKind, Readonly<Record<TurnAction, TurnPolicy>>>> = {
  online: {
    give: { timed: true, thinks: false },
    lead: { timed: true, thinks: true },
    follow: { timed: true, thinks: true },
  },
  offline: {
    give: { timed: false, thinks: false },
    lead: { timed: false, thinks: true },
    follow: { timed: true, thinks: true },
  },
};

export const BOT_THINK_MS = 1200;

export interface TurnSlot {
  seat: number;
  bot: boolean;
  action: TurnAction;
  gates: readonly Gate[];
  timed: boolean;
  thinkMs: number;
}

const NO_GATES: readonly Gate[] = [];

function tableGates(state: GameState): readonly Gate[] {
  switch (state.lastMove.kind) {
    case "deal":
      if (state.exchangePhase?.kind === "open") return ["deal", "receive"];
      if (state.exchangePhase?.kind === "twoJokers") return ["deal", "ceremony"];
      return ["deal"];
    case "giveback":
      return ["ceremony"];
    default:
      return NO_GATES;
  }
}

/**
 * Who acts next, after which gates, and whether against a deadline; null once the round is over.
 * A human's gates are only the opening notice: its own client holds it there, out of the server's
 * sight, while every other gate runs inside the human's own window.
 */
export function turnSchedule(state: GameState, table: TableKind, isBot: (seat: number) => boolean): TurnSlot | null {
  if (state.roundOver) return null;
  const seat = actingSeat(state);
  const bot = isBot(seat);
  const action: TurnAction =
    state.exchangePhase?.kind === "open" ? "give" : state.lastPlayedCombination === null ? "lead" : "follow";
  const policy = TURN_POLICY[table][action];
  return {
    seat,
    bot,
    action,
    gates: bot ? tableGates(state) : openingIsPending(state) ? ["opening"] : NO_GATES,
    timed: !bot && policy.timed,
    thinkMs: bot && policy.thinks ? BOT_THINK_MS : 0,
  };
}
