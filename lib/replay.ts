// A finished hand, stored as what was played and folded back into the state
// the table renders.
//
// Hand-free by construction: a replay shows what left each hand, never what
// stayed in it, so every player's `hand` is empty and the table draws from
// `handCount` exactly as it does for a spectator.
//
// Pure — no react-native import — so `node --test` and the server both load it.
import type { Combination, GameMode, GameState, Player } from "./gameEngine.ts";

export interface ReplaySeat {
  seatIndex: number;
  /** null for a bot seat. */
  userId: string | null;
  name: string;
}

export interface ReplayMove {
  seat: number;
  /** The combination played, or null for a pass. */
  combo: Combination | null;
  /** Cards left in every seat's hand immediately after this move. */
  handCounts: number[];
}

export interface ReplayDto {
  id: string;
  finishedAt: string;
  gameMode: GameMode;
  seats: ReplaySeat[];
  moves: ReplayMove[];
  /** Engine player ids in finishing order, as the hand ended. */
  rankings: string[];
}

/** What the profile lists: enough to name a hand, without its move log. */
export interface ReplaySummary {
  id: string;
  finishedAt: string;
  gameMode: GameMode;
  playerCount: number;
  moveCount: number;
  seats: ReplaySeat[];
}

/**
 * A hand cannot legally run this long — 54 cards, and a round of passes ends
 * the round. The cap is a server-memory bound against a hand that loops, not a
 * game rule: past it the log is dropped and no replay is written.
 */
export const MAX_REPLAY_MOVES = 1000;

/** Table seats carry a count instead of a hand, the shape the server sanitises to. */
type ReplayPlayer = Player & { handCount: number };

export function replayMoveCount(replay: ReplayDto): number {
  return replay.moves.length;
}

/** Hand sizes before any move: the first move's counts, with its own cards back. */
function openingCounts(replay: ReplayDto): number[] {
  const first = replay.moves[0];
  if (!first) return replay.seats.map(() => 0);
  const counts = [...first.handCounts];
  counts[first.seat] += first.combo?.cards.length ?? 0;
  return counts;
}

/**
 * The table state after move `index`. `-1` is the opening position; anything
 * outside the log is clamped to one of the two ends rather than throwing,
 * because the scrubber driving it is a user input.
 */
export function replayStateAt(replay: ReplayDto, index: number): GameState {
  const last = replay.moves.length - 1;
  const at = Math.max(-1, Math.min(index, last));
  const counts = at < 0 ? openingCounts(replay) : replay.moves[at].handCounts;

  // The pile is the newest play at or before `at` — a pass leaves it standing.
  let pile: GameState["lastPlayedCombination"] = null;
  let pileSeat = -1;
  for (let i = 0; i <= at; i++) {
    const move = replay.moves[i];
    if (move.combo) {
      pile = move.combo;
      pileSeat = move.seat;
    }
  }

  const finished = at === last && last >= 0;
  const players: ReplayPlayer[] = replay.seats.map((seat, i) => ({
    id: `player_${seat.seatIndex}`,
    name: seat.name,
    hand: [],
    handCount: counts[i] ?? 0,
    type: "human",
  }));

  return {
    players,
    // Whoever moved next, so the table highlights the seat about to act.
    currentTurnIndex: replay.moves[at + 1]?.seat ?? replay.moves[at]?.seat ?? 0,
    lastPlayedCombination: pile,
    lastPlayedBy: pileSeat,
    passCount: 0,
    gameMode: replay.gameMode,
    roundWinner: null,
    gameOver: finished,
    rankings: finished ? replay.rankings : [],
    firstPlayMade: at >= 0,
  };
}
