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
import { randomUUID } from "node:crypto";
import type { Server as SocketServer } from "socket.io";
import { logger } from "./logger.ts";
import { activeGames, isShuttingDown } from "./gameRoom.ts";
import { claimRoom, ownsRoom, releaseRoom } from "./gameOwnership.ts";
import type { EventOutcome } from "./socketSafety.ts";
import type { TableAction, TableActionDraft } from "./tableActions.ts";
import { takeoverMode } from "./tableActions.ts";

export const TABLE_ACTION_EVENT = "murlan:table";

/**
 * What an instance answers for a room it does not hold. Distinct from every
 * refusal a handler can produce, so "nobody owns this" is never confused with
 * "the owner said no".
 */
const NOT_MINE = "NOT_THIS_INSTANCE";

const UNOWNED: EventOutcome = { ok: false, code: "NO_LIVE_GAME" };

/**
 * Someone holds the room and could not be reached. Deliberately not
 * `NO_LIVE_GAME`: a caller that reads "there is no game" acts on it — the
 * disconnect path releases the seat as a lobby seat — and doing that because a
 * message was slow is worse than doing nothing.
 */
const UNREACHABLE: EventOutcome = { ok: false, code: "TABLE_UNREACHABLE" };

/** How many times an unanswered forward is tried again before giving up. */
const ASK_ATTEMPTS = 3;
const RETRY_BASE_MS = 120;

/**
 * How long an applied action's answer is remembered, for a forward that was
 * re-sent because the first answer did not come back in time.
 *
 * Comfortably past the adapter's own five-second acknowledgement window and the
 * retries above. `CLAUDE.md` is explicit that a card appears exactly once, and a
 * replayed `game:pass` would take a turn twice.
 */
const APPLIED_TTL_MS = 60_000;
const APPLIED_MAX = 2_000;

type Applier = (io: SocketServer, action: TableAction) => Promise<EventOutcome>;
/**
 * Puts a persisted game back in memory, for the caller named by `forUserId`.
 *
 * Three failures, not one: a row written under a shape this build cannot
 * restore is a different thing to tell the player than a table that was never
 * there, and a caller who holds no seat in the persisted roster must not be
 * able to pull a table into this instance's memory at all.
 */
type Rehydrator = (
  roomId: string,
  forUserId: string | null
) => Promise<"restored" | "missing" | "unrestorable" | "not_seated">;

let apply: Applier = async () => UNOWNED;
let rehydrate: Rehydrator = async () => "missing";

export function setTableHandlers(applier: Applier, rehydrator: Rehydrator): void {
  apply = applier;
  rehydrate = rehydrator;
}

/** Every action this process has already applied, by id. */
const applied = new Map<string, { outcome: EventOutcome; at: number }>();

function remember(id: string, outcome: EventOutcome): EventOutcome {
  const now = Date.now();
  for (const [key, entry] of applied) {
    if (now - entry.at > APPLIED_TTL_MS) applied.delete(key);
    else break;
  }
  // A bound as well as an expiry: a table storming actions must not be able to
  // grow this without limit before anything ages out of it.
  while (applied.size >= APPLIED_MAX) {
    const [oldest] = applied.keys();
    if (oldest === undefined) break;
    applied.delete(oldest);
  }
  applied.set(id, { outcome, at: now });
  return outcome;
}

async function applyOnce(io: SocketServer, action: TableAction): Promise<EventOutcome> {
  const seen = applied.get(action.id);
  if (seen && Date.now() - seen.at <= APPLIED_TTL_MS) return seen.outcome;
  return remember(action.id, await apply(io, action));
}

/**
 * Answers table actions other instances forward here.
 *
 * Always answers, including for rooms this process knows nothing about: the
 * asker sizes its wait by the number of live instances, so an instance that
 * stayed silent would cost every forwarded action the full acknowledgement
 * timeout.
 *
 * A room this instance has claimed but not finished loading answers too, once
 * the takeover it is in the middle of has settled. Answering `NOT_THIS_INSTANCE`
 * there would refuse every other player at the table for the width of one
 * restore — which is exactly the moment they are all acting at once.
 */
export function registerTableRouting(io: SocketServer): void {
  io.on(TABLE_ACTION_EVENT, (action: TableAction, reply?: (r: EventOutcome) => void) => {
    if (typeof reply !== "function") return;
    void (async () => {
      if (!activeGames.has(action.roomId)) {
        if (!ownsRoom(action.roomId)) return reply({ ok: false, code: NOT_MINE });
        await inFlight.get(action.roomId)?.catch(() => {});
        if (!activeGames.has(action.roomId)) return reply({ ok: false, code: NOT_MINE });
      }
      reply(await applyOnce(io, action));
    })().catch((err: unknown) => {
      logger.error(
        { err, action: action.kind, roomId: action.roomId },
        "Forwarded table action threw"
      );
      reply({ ok: false, code: "SERVER_ERROR" });
    });
  });
}

/**
 * The owner's answer, `null` when every instance disowned the room, and
 * `undefined` when at least one did not answer at all.
 */
function askOtherInstances(
  io: SocketServer,
  action: TableAction
): Promise<EventOutcome | null | undefined> {
  return new Promise((resolve) => {
    io.serverSideEmit(
      TABLE_ACTION_EVENT,
      action,
      (err: unknown, replies: EventOutcome[] = []) => {
        const owner = replies.find((r) => r?.code !== NOT_MINE);
        if (owner) return resolve(owner);
        // An error means some instance did not answer in time. Reading that as
        // "no owner" is how a slow owner's table gets taken over underneath it.
        if (err) {
          logger.debug(
            { roomId: action.roomId, action: action.kind },
            "Not every instance answered a forwarded table action"
          );
          return resolve(undefined);
        }
        resolve(null);
      }
    );
  });
}

/**
 * The takeover, and the action that triggered it, per room.
 *
 * The advisory lock keeps two *instances* off one room. It does nothing about
 * two actions on the same instance, because it is re-entrant within a session:
 * both would find no owner, both would be told they hold the room, and the
 * second would restore over the first — or hand the lock back in the middle of
 * a deal that is still running. So the whole of a takeover is serialised per
 * room, and everything else waits and then finds the game in memory.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * What `askClaimAndApply` returns when this attempt settled nothing: another
 * instance holds the room and could not be reached, so the caller sleeps and
 * asks again. Distinct from every `EventOutcome`, so "no answer yet" can never
 * be mistaken for one.
 */
const RETRY = Symbol("retry");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function takeOverAndApply(
  io: SocketServer,
  action: TableAction,
  mayCreate: boolean
): Promise<EventOutcome> {
  const { roomId } = action;
  const restored = await rehydrate(roomId, mayCreate ? null : action.userId);
  if (restored !== "restored" && !mayCreate) {
    // Nothing to own, or nothing this caller may own. Holding the lock would
    // keep the room off every other instance for the life of this process.
    await releaseRoom(roomId);
    if (restored === "unrestorable") return { ok: false, code: "GAME_NO_LONGER_VALID" };
    if (restored === "not_seated") return { ok: false, code: "UNAUTHORIZED" };
    return UNOWNED;
  }
  if (restored === "unrestorable") {
    // Discarding the row went through `disposeGame`, which hands the room back,
    // and the deal about to run would otherwise write a game with no claim.
    if (!(await claimRoom(roomId))) return UNREACHABLE;
  }
  try {
    return await applyOnce(io, action);
  } finally {
    // `startMatch` claims before it knows whether it will deal, and refuses for
    // half a dozen reasons after that.
    if (!activeGames.has(roomId)) await releaseRoom(roomId);
  }
}

/**
 * One attempt at finding the table's owner, becoming it, or reporting that the
 * question is still open.
 *
 * A function rather than the loop body it used to be, so the whole span from
 * the first question to the outcome is a single promise the loop can publish in
 * `inFlight` before any of it runs.
 */
async function askClaimAndApply(
  io: SocketServer,
  action: TableAction,
  mode: ReturnType<typeof takeoverMode>
): Promise<EventOutcome | typeof RETRY> {
  const { roomId } = action;
  const answer = await askOtherInstances(io, action);
  if (answer) return answer;

  // Every instance answered and none of them holds the room. Nothing to take
  // over, and no reason to ask Postgres — which matters more than it looks:
  // with one instance this is every lobby disconnect, every seat release and
  // every leave, and probing the lock for each cost a round trip apiece.
  // Reviving a stranded hand to give one seat to a bot would set the whole
  // table playing itself with nobody watching, so `forward` stops here.
  if (answer === null && mode === "forward") return UNOWNED;

  // Either nobody owns it or somebody could not answer. The lock is the
  // authority on which.
  if (!(await claimRoom(roomId))) return RETRY;
  if (mode === "forward") {
    await releaseRoom(roomId);
    return UNOWNED;
  }
  return takeOverAndApply(io, action, mode === "create");
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
  draft: TableActionDraft
): Promise<EventOutcome> {
  // Stamped once and kept across every retry below: a forward whose answer was
  // slow is re-sent, and the owner must recognise it rather than play it again.
  const action: TableAction = { ...draft, id: randomUUID() } as TableAction;
  const { roomId } = action;
  const mode = takeoverMode(action.kind);

  // A process on its way out routes nothing: its sockets are closing, its
  // ownership connection goes with them, and the next process restores every
  // table from `active_games`. Answering "no owner" is what puts the disconnect
  // path back on the lobby teardown a shutdown needs it to run.
  if (!activeGames.has(roomId) && isShuttingDown()) return UNOWNED;

  for (let attempt = 0; attempt < ASK_ATTEMPTS; attempt++) {
    // Another action may be restoring this very room; wait it out rather than
    // racing it. Bounded by the attempt count like everything else here, so a
    // takeover that never settles costs a refusal rather than a hung handler.
    await inFlight.get(roomId)?.catch(() => {});
    if (activeGames.has(roomId)) return applyOnce(io, action);
    if (inFlight.has(roomId)) continue;

    // Registered before the first `await` of the attempt and not one statement
    // later: the ask and the claim are both awaits, and a second action
    // entering across either of them would find nothing in flight, be handed
    // the room by the re-entrant lock, and restore over the first.
    const attemptSpan = askClaimAndApply(io, action, mode);
    inFlight.set(roomId, attemptSpan);
    let settled: EventOutcome | typeof RETRY;
    try {
      settled = await attemptSpan;
    } finally {
      // Every exit of the span, refusals and throws included: a waiter above is
      // parked on this entry and nothing else deletes it.
      inFlight.delete(roomId);
    }
    if (settled !== RETRY) return settled;

    // An instance holds the room: either it is still loading it, or it could
    // not answer in time. Ask again — the action carries an id, so a duplicate
    // that did land is answered from the owner's record, never replayed.
    await sleep(RETRY_BASE_MS * (attempt + 1));
  }

  logger.warn({ roomId, action: action.kind }, "The instance holding this table never answered");
  return UNREACHABLE;
}
