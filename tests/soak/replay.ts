// tests/soak/replay.ts — hands a soak log back to a real server, move for move.
//
// The soak is a search and its seed is a label: the deal comes from `crypto`
// (`lib/gameEngine.ts`'s `shuffleDeck`), so re-running a seed plays a different
// game with different cards, and the card ids a failure printed mean nothing in
// it. What survives the run is the log. This replays one, so a night's find can
// become a `tests/integration/` case that fails on demand for ever after
// (`tests/integration/soakLogReplays.test.ts`).
//
// It reports what did *not* apply as carefully as what did: a replay that
// quietly skips the move a defect hangs on would go green over the very thing
// it was written to pin.
import { setTimeout as sleep } from "node:timers/promises";
import { startTestServer, type TestServer } from "../helpers/testServer.ts";
import { reconnectWith, DEADLINE_SCALE } from "../helpers/client.ts";
import { redealExactly } from "../helpers/liveGame.ts";
import { createDeck } from "../../lib/gameEngine.ts";
import { checkAll, type SeatView, type Violation } from "./invariants.ts";
import { Seat, openTable, settle, type SoakLogEntry } from "./soak.ts";

/** How long one replayed move may take to come back as a broadcast. */
const MOVE_BUDGET_MS = 3_000 * DEADLINE_SCALE;

export interface SkippedMove {
  at: number;
  kind: string;
  why: string;
}

export interface ReplayResult {
  violations: Violation[];
  /** Moves the server broadcast a new table for. */
  applied: number;
  /** Moves it did not, with whatever the server said instead. */
  skipped: SkippedMove[];
  /** Cards left in each seat's hand when the log ran out. */
  finalCounts: number[];
  /** The move this stopped at, if the log stopped applying. */
  abandonedAt?: number;
}

/** The total of every seat's state counter — a broadcast to anyone moves it. */
function versionSum(seats: Seat[]): number {
  return seats.reduce((sum, s) => sum + s.version, 0);
}

async function waitForBroadcast(seats: Seat[], before: number): Promise<boolean> {
  const deadline = Date.now() + MOVE_BUDGET_MS;
  while (Date.now() < deadline) {
    if (versionSum(seats) !== before) return true;
    await sleep(25);
  }
  return false;
}

/**
 * Replays a log against a fresh server and reports what the table looked like
 * at the end of it.
 *
 * The first entry must be the deal: without it there is nothing to make the
 * card ids in the rest of the log mean anything, and a replay that started from
 * a fresh shuffle would be a different game wearing the log's move list.
 */
export async function replaySoakLog(
  log: SoakLogEntry[],
  /**
   * A server to replay on. Two replays in one process need one: `stop()` ends
   * the shared pg pool, and the second `startTestServer` then fails on a pool
   * that is already closed. Given one, this leaves it running.
   */
  existing?: TestServer
): Promise<ReplayResult> {
  const deal = log[0];
  if (deal?.kind !== "deal") {
    throw new Error("a soak log replays only from its deal, and this one does not start with one");
  }
  const known = new Set(createDeck().map((card) => card.id));
  for (const hand of deal.hands) {
    for (const id of hand) if (!known.has(id)) throw new Error(`no such card in the deck: ${id}`);
  }

  const server: TestServer = existing ?? (await startTestServer());
  const seats: Seat[] = [];
  const skipped: SkippedMove[] = [];
  let applied = 0;
  let abandonedAt: number | undefined;
  try {
    const room = await openTable(server, deal.hands.length, seats);
    await settle(seats);
    redealExactly(server.io, room.roomId, deal.hands);
    await settle(seats);

    for (const entry of log.slice(1)) {
      const seat = seats[entry.kind === "deal" ? 0 : entry.seat];
      if (entry.kind === "deal") {
        redealExactly(server.io, room.roomId, entry.hands);
        await settle(seats);
        continue;
      }
      if (entry.kind === "drop") {
        seat.socket.close();
        await sleep(200);
        continue;
      }
      if (entry.kind === "rejoin") {
        const back = await reconnectWith(server, seat.cookie);
        const before = seat.version;
        seat.adopt(back);
        back.emit("game:rejoin", { roomId: room.roomId });
        const answeredBy = Date.now() + MOVE_BUDGET_MS;
        while (seat.version === before && Date.now() < answeredBy) await sleep(50);
        if (seat.version === before) {
          skipped.push({ at: entry.at, kind: entry.kind, why: seat.lastRefusal ?? "no answer at all" });
        }
        continue;
      }

      const before = versionSum(seats);
      seat.lastRefusal = null;
      if (entry.kind === "play") seat.socket.emit("game:play", { cardIds: entry.cardIds });
      else if (entry.kind === "pass") seat.socket.emit("game:pass");
      else seat.socket.emit("game:exchange_give_card", { cardId: entry.cardId });

      if (await waitForBroadcast(seats, before)) {
        applied += 1;
        continue;
      }
      // The first refusal ends the reproduction. Every later entry was written
      // against a table that took this move, so replaying them is a different
      // game wearing the log's move list — and the turn arbiter plays for a
      // stuck seat on its own, which makes some of them look like they applied.
      // Counting refusals instead of stopping at one made this depend on how
      // they happened to cluster, and it read differently on CI than here.
      skipped.push({ at: entry.at, kind: entry.kind, why: seat.lastRefusal ?? "no answer at all" });
      abandonedAt = entry.at;
      break;
    }

    await settle(seats);
    const views = seats.map((s) => s.view()).filter((v): v is SeatView => v !== null);
    return {
      violations: checkAll(views, createDeck().length, createDeck().length),
      applied,
      skipped,
      finalCounts: views[0]?.handCounts ?? [],
      abandonedAt,
    };
  } finally {
    for (const seat of seats) if (seat.socket.connected) seat.socket.close();
    if (!existing) await server.stop();
  }
}
