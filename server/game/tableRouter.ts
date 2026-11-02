// server/game/tableRouter.ts — sends a table action to the instance that owns the
// table.
//
// `rt.out.room(roomId)` crosses instances; `activeGames.get(roomId)` does not. So a
// player whose socket landed on an instance that did not deal the round saw the
// table perfectly and was refused every move. This is the other half: the
// action travels to the game rather than the game being read where the action
// arrived.
//
// The carrier is the owner's inbox: one message to the instance the table's owner record names,
// one answer back to the asker's (ADR 0014, decision 3).
import { now } from "../http/clock.ts";
import { randomUUID } from "node:crypto";
import type { TableRuntime } from "./tableRuntime.ts";
import { logger } from "../shared/logger.ts";
import { activeGames, isShuttingDown } from "./gameRoom.ts";
import { claimRoom, lockHolder, ownsRoom, releaseRoom } from "./gameOwnership.ts";
import type { Outcome } from "../shared/refusal.ts";
import type { TableAction, TableActionDraft, TakeoverMode } from "./tableActions.ts";
import { TAKEOVER } from "./tableActions.ts";
import { applyTableAction } from "./tableHandlers.ts";
import { rehydrateGame } from "./tableLifecycle.ts";

export const TABLE_ASK = "table-ask";
export const TABLE_ANSWER = "table-answer";

/**
 * What an instance answers for a room it does not hold. Distinct from every
 * refusal a handler can produce, so "nobody owns this" is never confused with
 * "the owner said no".
 */
const NOT_MINE = "NOT_THIS_INSTANCE";

const UNOWNED: Outcome = { ok: false, code: "NO_LIVE_GAME" };

/**
 * Someone holds the room and could not be reached. Deliberately not
 * `NO_LIVE_GAME`: a caller that reads "there is no game" acts on it — the
 * disconnect path releases the seat as a lobby seat — and doing that because a
 * message was slow is worse than doing nothing.
 */
const UNREACHABLE: Outcome = { ok: false, code: "TABLE_UNREACHABLE" };

export const UNKNOWN_ACTION: Outcome = { ok: false, code: "UNKNOWN_ACTION" };

/** Every try and the lock probes after them stay under the client's 4 s per try (`lib/sendIntent.ts`). */
const ASK_TIMEOUT_MS = 1_500;
const ASK_ATTEMPTS = 2;
const RETRY_MS = 120;
/** Past a live owner's answer; an owner that has not answered by then has its lock read. */
const PROBE_AFTER_MS = 250;
const NO_ANSWER = Symbol("no answer");

/**
 * How long an applied action's answer is remembered, for an intent re-sent because its answer
 * did not come back in time: past the client's every try (`lib/sendIntent.ts`). `CLAUDE.md` is
 * explicit that a card appears exactly once, and a replayed `game:pass` would take a turn twice.
 * The bound is far past what that window holds at any real rate, so it never cuts the window short.
 */
const APPLIED_TTL_MS = 120_000;
const APPLIED_MAX = 50_000;

/**
 * Puts a persisted game back in memory, for the caller named by `forUserId`.
 *
 * Four failures, not one: a row written under a shape this build cannot
 * restore is a different thing to tell the player than a table that was never
 * there, a row a newer revision wrote is that revision's to serve, and a caller
 * who holds no seat in the persisted roster must not be able to pull a table
 * into this instance's memory at all.
 */
export type RehydrateOutcome = "restored" | "missing" | "unrestorable" | "newer" | "not_seated" | "lost";

/** Every action this process has already applied, by id. */
const applied = new Map<string, { outcome: Promise<Outcome>; at: number }>();

/** What a process restart does to the record above: tests stand in for one with this. */
export function forgetAppliedIntents(): void {
  applied.clear();
}

function remember(id: string, outcome: Promise<Outcome>): Promise<Outcome> {
  const at = now();
  for (const [key, entry] of applied) {
    if (at - entry.at > APPLIED_TTL_MS) applied.delete(key);
    else break;
  }
  // A bound as well as an expiry: a table storming actions must not be able to
  // grow this without limit before anything ages out of it.
  while (applied.size >= APPLIED_MAX) {
    const [oldest] = applied.keys();
    if (oldest === undefined) break;
    applied.delete(oldest);
  }
  applied.set(id, { outcome, at });
  return outcome;
}

/**
 * Remembered before it settles: a client retry can arrive on another socket
 * while the first attempt is still being applied.
 */
function applyOnce(rt: TableRuntime, action: TableAction): Promise<Outcome> {
  const seen = applied.get(action.id);
  if (seen && now() - seen.at <= APPLIED_TTL_MS) return seen.outcome;
  const outcome = applyTableAction(rt, action);
  outcome.catch(() => applied.delete(action.id));
  return remember(action.id, outcome);
}

/** What this instance answers a forwarded action with, as the owner or as one that is not. */
async function answerAsOwner(rt: TableRuntime, action: TableAction): Promise<Outcome> {
  if (!activeGames.has(action.roomId)) {
    if (!ownsRoom(action.roomId)) return { ok: false, code: NOT_MINE };
    await inFlight.get(action.roomId)?.catch(() => {});
    if (!activeGames.has(action.roomId)) return { ok: false, code: NOT_MINE };
  }
  return applyOnce(rt, action);
}

/** Asks waiting on their owner's answer, by ask id. */
const waiting = new Map<string, (outcome: Outcome | undefined) => void>();

/**
 * Answers table actions other instances forward here, and hands their answers to the asks
 * waiting on them.
 *
 * Answers a room this process does not hold too: the asker then reads the lock at once rather
 * than after its timeout. A room this instance has claimed but not finished loading is answered
 * once the takeover it is in the middle of has settled: answering `NOT_THIS_INSTANCE` there would
 * refuse every other player at the table for the width of one restore — which is exactly the
 * moment they are all acting at once.
 */
export function registerTableRouting(rt: TableRuntime): void {
  rt.peers.on(TABLE_ASK, ({ from, ask, action }) => {
    if (typeof from !== "string" || typeof ask !== "string" || !action) return;
    const tableAction = action as TableAction;
    const answer = (outcome: Outcome) =>
      rt.peers
        .send(from, { kind: TABLE_ANSWER, ask, outcome })
        .catch((err: unknown) => logger.warn({ err, roomId: tableAction.roomId }, "Could not answer a forwarded table action"));
    // Not awaited: the inbox hands this instance its messages one at a time.
    void answerAsOwner(rt, tableAction).then(answer, (err: unknown) => {
      logger.error({ err, action: tableAction.kind, roomId: tableAction.roomId }, "Forwarded table action threw");
      return answer({ ok: false, code: "SERVER_ERROR" });
    });
  });
  rt.peers.on(TABLE_ANSWER, ({ ask, outcome }) => {
    if (typeof ask === "string") waiting.get(ask)?.(outcome as Outcome | undefined);
  });
}

/**
 * The owner's answer; `unowned` when no record names another instance or the one named does not
 * hold the room; `silent` when nothing came back in time; `gone` when the ask could not be handed
 * over at all.
 */
type Asked = Outcome | "unowned" | "silent" | "gone";

/** Resolves `value` after `ms`, unless `cancel` runs first. */
function after<T>(ms: number, value: T): { done: Promise<T>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(value), ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
}

async function askOwner(rt: TableRuntime, action: TableAction): Promise<Asked> {
  const ask = randomUUID();
  const expired = after(ASK_TIMEOUT_MS, "silent" as const);
  const asked = (async (): Promise<Asked> => {
    const owner = await rt.peers.ownerOf(action.roomId).catch((err: unknown) => {
      logger.warn({ err, roomId: action.roomId }, "Could not read a table's owner record");
      return null;
    });
    if (!owner || owner === rt.peers.self) return "unowned";
    const answered = new Promise<Outcome | undefined>((resolve) => waiting.set(ask, resolve));
    try {
      await rt.peers.send(owner, { kind: TABLE_ASK, from: rt.peers.self, ask, action });
    } catch {
      return "gone";
    }
    // A crashed owner's record outlives it by up to three heartbeats, and its inbox takes the ask.
    const slow = after(PROBE_AFTER_MS, NO_ANSWER);
    const early = await Promise.race([answered, slow.done]);
    slow.cancel();
    if (early === NO_ANSWER) {
      const holder = await lockHolder(action.roomId);
      if (holder === "free" || holder === "mine") return "unowned";
    }
    const outcome = early === NO_ANSWER ? await answered : early;
    // An owner running a revision without a `default` for this kind answers with nothing; it
    // answered, and it did not apply the action.
    if (outcome === undefined) return UNKNOWN_ACTION;
    return outcome.code === NOT_MINE ? "unowned" : outcome;
  })();
  try {
    return await Promise.race([asked, expired.done]);
  } finally {
    expired.cancel();
    waiting.delete(ask);
  }
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
export const inFlight = new Map<string, Promise<unknown>>();

/**
 * What `askClaimAndApply` returns when this attempt settled nothing: another
 * instance holds the room and could not be reached, so the caller sleeps and
 * asks again. Distinct from every `Outcome`, so "no answer yet" can never
 * be mistaken for one.
 */
const RETRY = Symbol("retry");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function takeOverAndApply(
  rt: TableRuntime,
  action: TableAction,
  mayCreate: boolean
): Promise<Outcome> {
  const { roomId } = action;
  const restored = await rehydrateGame(rt, roomId, mayCreate ? null : action.userId);
  if (restored === "newer" || restored === "lost") {
    await releaseRoom(roomId);
    return UNREACHABLE;
  }
  if (restored !== "restored" && !mayCreate) {
    // Nothing to own, or nothing this caller may own. Holding the lock would
    // keep the room off every other instance for the life of this process.
    await releaseRoom(roomId);
    if (restored === "unrestorable") return { ok: false, code: "GAME_NO_LONGER_VALID" };
    if (restored === "not_seated") return { ok: false, code: "UNAUTHORIZED" };
    return UNOWNED;
  }
  try {
    return await applyOnce(rt, action);
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
  rt: TableRuntime,
  action: TableAction,
  mode: TakeoverMode
): Promise<Outcome | typeof RETRY> {
  const { roomId } = action;
  const asked = await askOwner(rt, action);
  if (typeof asked === "object") return asked;

  // Nobody answered for it, or the one named does not hold it: the lock is the authority on
  // whether anyone does. An ask that could not even be handed over is not tried again.
  const holder = await lockHolder(roomId);
  if (holder === "elsewhere" || holder === "unreachable") return asked === "gone" ? UNREACHABLE : RETRY;
  // Reviving a stranded round to give one seat to a bot would set the whole table playing itself
  // with nobody watching, so `forward` stops here.
  if (holder === "free" && mode === "forward") return UNOWNED;

  if (!(await claimRoom(roomId))) return RETRY;
  if (mode === "forward") {
    await releaseRoom(roomId);
    return UNOWNED;
  }
  return takeOverAndApply(rt, action, mode === "create");
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
  rt: TableRuntime,
  draft: TableActionDraft
): Promise<Outcome> {
  // Stamped once and kept across every retry below: a forward whose answer was
  // slow is re-sent, and the owner must recognise it rather than play it again.
  // Scoped by user so one player's id can never answer for another's intent.
  const { intentId, ...rest } = draft;
  const id = intentId ? `${draft.userId}:${intentId}` : randomUUID();
  const action: TableAction = { ...rest, id } as TableAction;
  const { roomId } = action;
  const mode = TAKEOVER[action.kind];

  // A process on its way out takes nothing over: its ownership connection is
  // closing and the next process restores every table from `active_games`. It
  // still asks, because a table held elsewhere must hear that its player left.
  if (!activeGames.has(roomId) && isShuttingDown()) {
    const asked = await askOwner(rt, action);
    if (typeof asked === "object") return asked;
    if (asked === "gone") return UNREACHABLE;
    const holder = await lockHolder(roomId);
    return holder === "elsewhere" || holder === "unreachable" ? UNREACHABLE : UNOWNED;
  }

  for (let attempt = 0; attempt < ASK_ATTEMPTS; attempt++) {
    // Another action may be restoring this very room; wait it out rather than
    // racing it. Bounded by the attempt count like everything else here, so a
    // takeover that never settles costs a refusal rather than a hung handler.
    await inFlight.get(roomId)?.catch(() => {});
    if (activeGames.has(roomId)) return applyOnce(rt, action);
    if (inFlight.has(roomId)) continue;

    // Registered before the first `await` of the attempt and not one statement
    // later: the ask and the claim are both awaits, and a second action
    // entering across either of them would find nothing in flight, be handed
    // the room by the re-entrant lock, and restore over the first.
    const attemptSpan = askClaimAndApply(rt, action, mode);
    inFlight.set(roomId, attemptSpan);
    let settled: Outcome | typeof RETRY;
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
    if (attempt + 1 < ASK_ATTEMPTS) await sleep(RETRY_MS);
  }

  logger.warn({ roomId, action: action.kind }, "The instance holding this table never answered");
  return UNREACHABLE;
}
