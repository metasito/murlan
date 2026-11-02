// Commits one finished round through the production results transaction, the way a table does:
// the round pending in an `active_games` row at a fresh epoch, then committed and cleared.
import { randomUUID } from "node:crypto";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { commitRoundResults, type ResultsCommit } from "../../server/game/roundResults.ts";
import type { GameResult } from "../../lib/achievements.ts";
import type { GameMode, LastMove } from "../../lib/game/gameEngine.ts";
import type { ReplayMove, ReplaySeat } from "../../lib/game/replay.ts";
import type { PendingResult, PersistedEnvelope } from "../../shared/persistedEnvelope.ts";

export interface RoundInput {
  roomId?: string;
  seats?: ReplaySeat[];
  moves?: ReplayMove[] | null;
  opening?: LastMove | null;
  finishingOrder?: string[];
}

export function pendingEntry(results: GameResult[], gameMode: GameMode, finishedAt: Date, input: RoundInput = {}): PendingResult {
  return {
    round: finishedAt.getTime(),
    finishedAt: finishedAt.getTime(),
    gameMode,
    results,
    outcome: {
      finishingOrder: input.finishingOrder ?? [],
      scores: [],
      matchTarget: 21,
      matchLength: "match",
      roundsPlayed: 1,
      matchOver: false,
      matchWinnerIds: [],
      matchContinues: true,
      isDraw: false,
      recorded: true,
      voided: false,
    },
    seats: input.seats ?? [],
    opening: input.opening ?? null,
    moveLog: input.moves ?? null,
  };
}

/** A row holding only `entries` pending, at a fresh epoch. */
export async function pendingRow(roomId: string, entries: PendingResult[]): Promise<number> {
  const { epoch } = await activeGameStore.claim(roomId);
  const envelope = {} as PersistedEnvelope;
  await activeGameStore.write(roomId, envelope, epoch);
  for (const entry of entries) await activeGameStore.write(roomId, envelope, epoch, entry);
  return epoch;
}

export async function recordRound(
  results: GameResult[],
  gameMode: GameMode,
  finishedAt: Date,
  input: RoundInput = {}
): Promise<ResultsCommit> {
  const roomId = input.roomId ?? `recorded-${randomUUID()}`;
  const entry = pendingEntry(results, gameMode, finishedAt, input);
  const epoch = await pendingRow(roomId, [entry]);
  try {
    return await commitRoundResults(activeGameStore, roomId, epoch, entry, { markFinished: false });
  } finally {
    await activeGameStore.remove(roomId, epoch);
  }
}
