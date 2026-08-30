// server/tableRouter.ts — sends a table action to the instance that owns the
// table.
//
// `io.to(roomId)` crosses instances; `activeGames.get(roomId)` does not. So a
// player whose socket landed on an instance that did not deal the hand saw the
// table perfectly and was refused every move. This is the other half: the
// action travels to the game rather than the game being read where the action
// arrived.
//
// The carrier is the adapter's own `serverSideEmit`, which the Postgres adapter
// already implements with acknowledgements. No second channel, and it inherits
// the adapter's delivery rather than inventing one.
import type { Server as SocketServer } from "socket.io";
import { logger } from "./logger.ts";
import { activeGames } from "./gameRoom.ts";
import { claimRoom, releaseRoom } from "./gameOwnership.ts";
import type { EventOutcome } from "./socketSafety.ts";
import type { TableAction } from "./tableActions.ts";
import { takeoverMode } from "./tableActions.ts";

export const TABLE_ACTION_EVENT = "murlan:table";

/**
 * What an instance answers for a room it does not hold. Distinct from every
 * refusal a handler can produce, so "nobody owns this" is never confused with
 * "the owner said no".
 */
const NOT_MINE = "NOT_THIS_INSTANCE";

const UNOWNED: EventOutcome = { ok: false, code: "NO_LIVE_GAME" };

type Applier = (io: SocketServer, action: TableAction) => Promise<EventOutcome>;
/**
 * Puts a persisted game back in memory.
 *
 * Three answers, not two: a row written under a shape this build cannot
 * restore is a different thing to tell the player than a table that was never
 * there, and collapsing them would leave a rejoining player reading "game not
 * found" about a game they were in a moment ago.
 */
type Rehydrator = (roomId: string) => Promise<"restored" | "missing" | "unrestorable">;

let apply: Applier = async () => UNOWNED;
let rehydrate: Rehydrator = async () => "missing";

export function setTableHandlers(applier: Applier, rehydrator: Rehydrator): void {
  apply = applier;
  rehydrate = rehydrator;
}

/**
 * Answers table actions other instances forward here.
 *
 * Always answers, including for rooms this process knows nothing about: the
 * asker sizes its wait by the number of live instances, so an instance that
 * stayed silent would cost every forwarded action the full acknowledgement
 * timeout.
 */
export function registerTableRouting(io: SocketServer): void {
  io.on(TABLE_ACTION_EVENT, (action: TableAction, reply?: (r: EventOutcome) => void) => {
    if (typeof reply !== "function") return;
    if (!activeGames.has(action.roomId)) {
      reply({ ok: false, code: NOT_MINE });
      return;
    }
    void apply(io, action)
      .then(reply)
      .catch((err: unknown) => {
        logger.error({ err, action: action.kind, roomId: action.roomId }, "Forwarded table action threw");
        reply({ ok: false, code: "SERVER_ERROR" });
      });
  });
}

/** The owner's answer, or null when no instance claimed the room. */
function askOtherInstances(
  io: SocketServer,
  action: TableAction
): Promise<EventOutcome | null> {
  return new Promise((resolve) => {
    io.serverSideEmit(
      TABLE_ACTION_EVENT,
      action,
      (err: unknown, replies: EventOutcome[] = []) => {
        // An error here means some instance did not answer in time, not that
        // nobody did — the replies that did arrive are still in hand, and the
        // claim below is what keeps a missing answer from becoming a second
        // owner.
        if (err) {
          logger.debug(
            { roomId: action.roomId, action: action.kind },
            "Not every instance answered a forwarded table action"
          );
        }
        resolve(replies.find((r) => r?.code !== NOT_MINE) ?? null);
      }
    );
  });
}

/**
 * Takeovers in flight, by room.
 *
 * The claim keeps two *instances* from taking one room. It does nothing about
 * two actions on the same instance: both find no owner, both claim (the lock is
 * re-entrant within a session), both read `active_games`, and the second
 * overwrites the first — losing whatever move the first had already applied.
 * So a room is taken over once and the rest of the queue waits for it.
 */
const takeovers = new Map<string, Promise<"restored" | "missing" | "unrestorable" | "not_ours">>();

function takeOver(
  roomId: string,
  mayCreate: boolean
): Promise<"restored" | "missing" | "unrestorable" | "not_ours"> {
  const running = takeovers.get(roomId);
  if (running) return running;
  const attempt = (async () => {
    if (!(await claimRoom(roomId))) return "not_ours";
    const restored = await rehydrate(roomId);
    if (restored === "restored") return restored;
    // A claim that did not end in a game — a `room:start` about to be refused,
    // a row that was gone — must not keep the room off every other instance for
    // the life of this process.
    if (!mayCreate) {
      await releaseRoom(roomId);
      return restored;
    }
    // Taken again because discarding an unrestorable row goes through
    // `disposeGame`, which hands the room back — and the deal about to run
    // would then write a game this instance has no claim on.
    return (await claimRoom(roomId)) ? restored : "not_ours";
  })().finally(() => takeovers.delete(roomId));
  takeovers.set(roomId, attempt);
  return attempt;
}

/**
 * Runs a table action wherever the table is.
 *
 * When no instance holds it, this one takes it over: claims the room, restores
 * it from `active_games`, and runs the action itself. That is what makes an
 * instance dying a non-event — the next action from any player picks the table
 * up — and the claim is what stops two instances doing it at once.
 */
export async function applyOrForward(
  io: SocketServer,
  action: TableAction
): Promise<EventOutcome> {
  const { roomId } = action;
  if (activeGames.has(roomId)) return apply(io, action);

  const remote = await askOtherInstances(io, action);
  if (remote) return remote;

  const mode = takeoverMode(action.kind);
  if (mode === "forward") return UNOWNED;

  const taken = await takeOver(roomId, mode === "create");
  if (taken === "not_ours") {
    // Another instance claimed it between the question and the answer. It is
    // the owner now, so ask again rather than refusing a table that exists.
    const second = await askOtherInstances(io, action);
    return second ?? UNOWNED;
  }
  if (taken === "unrestorable") return { ok: false, code: "GAME_NO_LONGER_VALID" };
  if (taken === "missing" && mode !== "create") return UNOWNED;

  try {
    return await apply(io, action);
  } finally {
    // `startMatch` claims before it knows whether it will deal, and refuses for
    // half a dozen reasons after that.
    if (!activeGames.has(roomId)) await releaseRoom(roomId);
  }
}
