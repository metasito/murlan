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
// it was written to pin. A refusal carries the server's own code, so a log long
// enough to trip the per-socket action rate limit says so rather than reading as
// the log having diverged.
import { setTimeout as sleep } from "node:timers/promises";
import { startTestServer, type TestServer } from "../helpers/testServer.ts";
import { reconnectWith, DEADLINE_SCALE } from "../helpers/client.ts";
import { redealExactly, forgetActiveGame } from "../helpers/liveGame.ts";
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

/**
 * Waits for the table the *acting* seat is sent, not for any broadcast at all.
 *
 * The server addresses each recipient separately, and re-sends to a seat that
 * did not acknowledge, so a total over every seat's counter still moves for the
 * previous move while this one is being refused — which counts a refusal as
 * applied and hides the divergence the log exists to expose.
 */
async function waitForOwnBroadcast(actor: Seat, before: number): Promise<boolean> {
  const deadline = Date.now() + MOVE_BUDGET_MS;
  while (Date.now() < deadline) {
    if (actor.version !== before) return true;
    await sleep(25);
  }
  return false;
}

/** Resolves once every seat has been sent a table, rather than after a quiet gap. */
async function waitForFirstState(seats: Seat[]): Promise<boolean> {
  const deadline = Date.now() + MOVE_BUDGET_MS;
  while (Date.now() < deadline) {
    if (seats.every((s) => s.state !== null)) return true;
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
  for (const entry of log) {
    if (entry.kind === "deal" || entry.seat < deal.hands.length) continue;
    throw new Error(`the log names seat ${entry.seat} at move ${entry.at}, of ${deal.hands.length}`);
  }
  // A second deal is a rematch, and a rematch does not start where this can put
  // a table: `initializeRematch` opens in the exchange, with the loser's best
  // card already moved and the winner to act, and `redealExactly` can only
  // build the shape `initializeGame` produces. Replaying past one would rebuild
  // the wrong kind of table and report the log's own `exchange` entry as its
  // divergence, which is a confident lie about where the defect is.
  if (log.slice(1).some((entry) => entry.kind === "deal")) {
    throw new Error("a log spanning more than one manche cannot be replayed yet — see #597");
  }

  const server: TestServer = existing ?? (await startTestServer());
  const seats: Seat[] = [];
  const skipped: SkippedMove[] = [];
  const violations: Violation[] = [];
  const deckSize = createDeck().length;
  let applied = 0;
  let abandonedAt: number | undefined;
  let highWaterMark = deckSize;
  let roomId = "";
  try {
    roomId = (await openTable(server, deal.hands.length, seats)).roomId;
    // `openTable` returns as soon as `room:start` is emitted, and `settle`
    // returns after any 250ms with no broadcast — which is exactly the state of
    // a table whose deal has not happened yet. Without this, `redealExactly`
    // finds no live game, returns false, and the replay runs against the
    // server's own shuffle with every move refused for a reason that is not the
    // log's.
    if (!(await waitForFirstState(seats))) {
      throw new Error("the table never dealt, so there was nothing to replay onto");
    }
    if (!redealExactly(server.io, roomId, deal.hands)) {
      throw new Error(`no live game for room ${roomId} to deal into`);
    }
    await settle(seats);

    for (const entry of log.slice(1)) {
      if (entry.kind === "deal") continue;
      const seat = seats[entry.seat];
      if (entry.kind === "drop") {
        seat.socket.close();
        await sleep(200);
        continue;
      }
      if (entry.kind === "rejoin") {
        const back = await reconnectWith(server, seat.cookie);
        const before = seat.version;
        seat.adopt(back);
        back.emit("game:rejoin", { roomId });
        const answeredBy = Date.now() + MOVE_BUDGET_MS;
        while (seat.version === before && Date.now() < answeredBy) await sleep(50);
        if (seat.version === before) {
          skipped.push({ at: entry.at, kind: entry.kind, why: seat.lastRefusal ?? "no answer at all" });
        }
        continue;
      }

      // Every move starts from a quiet table, so the broadcast this waits for
      // cannot be the previous move's still arriving.
      await settle(seats);
      const before = seat.version;
      seat.clearRefusal();
      if (entry.kind === "play") seat.socket.emit("game:play", { cardIds: entry.cardIds });
      else if (entry.kind === "pass") seat.socket.emit("game:pass");
      else seat.socket.emit("game:exchange_give_card", { cardId: entry.cardId });

      if (await waitForOwnBroadcast(seat, before)) {
        applied += 1;
        // Every move, as the soak's own oracle does. Checking once at the end
        // would miss a disagreement a later broadcast papers over, and the
        // high-water mark is carried rather than pinned at the deck size, where
        // "cards appeared" could only fire on something `checkCards` already
        // reports.
        const seen = seats.map((s) => s.view()).filter((v): v is SeatView => v !== null);
        const total = seen[0]?.handCounts.reduce((a, b) => a + b, 0) ?? 0;
        violations.push(...checkAll(seen, deckSize, highWaterMark));
        highWaterMark = Math.max(total, highWaterMark);
        if (violations.length > 0) {
          abandonedAt = entry.at;
          break;
        }
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
    violations.push(...checkAll(views, deckSize, highWaterMark));
    return {
      violations,
      applied,
      skipped,
      finalCounts: views[0]?.handCounts ?? [],
      abandonedAt,
    };
  } finally {
    for (const seat of seats) if (seat.socket.connected) seat.socket.close();
    // The room's turn timer outlives the sockets, and on a shared server it
    // would fire during the next replay — or after the schema is dropped, where
    // its auto-pass writes to a database that is gone.
    if (roomId) forgetActiveGame(roomId);
    if (!existing) await server.stop();
  }
}
