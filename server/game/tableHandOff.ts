// server/game/tableHandOff.ts — a process on its way out gives each table it plays to a live peer
// before it closes a socket (ADR 0014, decision 11), so no table sits unowned with its bot and AFK
// timers stopped until someone happens to act on it.
import { randomUUID } from "node:crypto";
import { now } from "../http/clock.ts";
import { logger } from "../shared/logger.ts";
import { activeGames, type OnlineGameState } from "./gameRoom.ts";
import { claimRoom } from "./gameOwnership.ts";
import { releaseToPeer } from "./gamePersistence.ts";
import { clearRoomDisconnectTimers, clearRoomLobbyGraces, clearRoomTimers } from "./gameTimers.ts";
import { roomWritesLanded } from "./roomWriteChain.ts";
import type { TableAction } from "./tableActions.ts";
import type { TableRuntime } from "./tableRuntime.ts";

export const HAND_OFF = "table-hand-off";
export const HAND_OFF_ANSWER = "table-hand-off-answer";

/** How long one peer has to claim before the next is offered the table. */
const PEER_ANSWER_MS = 1_000;

/**
 * Where a room's intents go once its hand-off has settled: to the peer that claimed it, or, with
 * `to` null, to nobody this process knows of. `kept` is a room this process still plays.
 */
export type HandedOff = { to: string | null } | "kept";

const handOffs = new Map<string, Promise<HandedOff>>();
const applying = new Map<string, Set<Promise<unknown>>>();
const answers = new Map<string, (claimed: boolean) => void>();

/** The room's hand-off while one has begun: from then on no intent is applied here. */
export function handOffOf(roomId: string): Promise<HandedOff> | undefined {
  return handOffs.get(roomId);
}

/** An intent being applied to a table here, which its hand-off waits for before its last write. */
export function noteApplying(roomId: string, outcome: Promise<unknown>): void {
  const running = applying.get(roomId) ?? new Set();
  applying.set(roomId, running);
  running.add(outcome);
  void outcome
    .catch(() => {})
    .finally(() => {
      running.delete(outcome);
      if (running.size === 0 && applying.get(roomId) === running) applying.delete(roomId);
    });
}

export function registerHandOff(rt: TableRuntime): void {
  rt.peers.on(HAND_OFF_ANSWER, ({ ask, claimed }) => {
    if (typeof ask === "string") answers.get(ask)?.(claimed === true);
  });
}

/** What `work` settles with, or `late` once `deadline` has passed. */
async function by<T>(deadline: number, work: Promise<T>, late: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(late), Math.max(0, deadline - now()))))]);
  } finally {
    clearTimeout(timer);
  }
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Every write the table has queued, those queued while waiting included. */
async function lastWriteLanded(roomId: string): Promise<void> {
  for (let tail = roomWritesLanded(roomId); ; ) {
    await tail.catch(() => {});
    const next = roomWritesLanded(roomId);
    if (next === tail) return;
    tail = next;
  }
}

/** Offers the room to each peer in turn; the first whose claim it hears of takes it. */
async function offer(rt: TableRuntime, action: TableAction, peers: readonly string[], deadline: number): Promise<string | null> {
  for (const peer of shuffled(peers)) {
    if (now() >= deadline) break;
    const ask = randomUUID();
    const answered = new Promise<boolean>((resolve) => answers.set(ask, resolve));
    try {
      const offered = await rt.peers
        .offer(peer, { kind: HAND_OFF, from: rt.peers.self, ask, action })
        .catch((err: unknown) => {
          logger.warn({ err, peer, roomId: action.roomId }, "Could not offer a table to a peer");
          return false;
        });
      if (!offered) continue;
      if (await by(Math.min(deadline, now() + PEER_ANSWER_MS), answered, false)) return peer;
    } finally {
      answers.delete(ask);
    }
  }
  return null;
}

async function handOff(rt: TableRuntime, roomId: string, game: OnlineGameState, peers: readonly string[], deadline: number): Promise<HandedOff> {
  clearRoomDisconnectTimers(game);
  clearRoomTimers(roomId);
  clearRoomLobbyGraces(roomId);
  const landed = Promise.allSettled([...(applying.get(roomId) ?? [])]).then(() => lastWriteLanded(roomId));
  if (!(await by(deadline, landed.then(() => true), false)) || activeGames.get(roomId) !== game) return "kept";
  const seated = Object.values(game.playerMap)[0] ?? [...game.vacatedSeats.values()][0]?.userId;
  if (seated === undefined) return "kept";
  const release = await releaseToPeer(roomId);
  if (!release) {
    logger.warn({ roomId }, "Could not release a table to hand it off; it is kept here");
    return "kept";
  }
  const to = await offer(rt, { kind: "resume", roomId, userId: seated, id: randomUUID() }, peers, deadline);
  if (to === null) {
    // Held again until this process exits, as before the hand-off: a free lock with nobody behind
    // it reads as no game anywhere, and a seat lost meanwhile would be released as a lobby seat.
    await claimRoom(roomId);
    await release.forget();
    logger.warn({ roomId }, "No peer claimed a table in time; the next owner restores it");
  }
  return { to };
}

/**
 * Hands every table this process plays to a live peer, all at once, within `budgetMs`. Per room:
 * stop taking intents, let the last write land, release the lock, offer the room to a live peer
 * and wait for its claim; the room's intents then go to that peer. With no live peer every table
 * is kept, and the next process restores it from `active_games`.
 */
export async function handOffTables(rt: TableRuntime, budgetMs: number): Promise<void> {
  const games = [...activeGames];
  if (games.length === 0) return;
  const peers = await rt.peers.live().catch((err: unknown) => {
    logger.warn({ err }, "Could not read the live peers; every table is kept");
    return [] as string[];
  });
  if (peers.length === 0) return;
  const deadline = now() + budgetMs;
  await Promise.all(
    games.map(([roomId, game]) => {
      if (activeGames.get(roomId) !== game) return;
      const handed = handOff(rt, roomId, game, peers, deadline).catch((err: unknown): HandedOff => {
        logger.error({ err, roomId }, "Table hand-off failed");
        return activeGames.get(roomId) === game ? "kept" : { to: null };
      });
      handOffs.set(roomId, handed);
      return handed.then((outcome) => {
        if (outcome === "kept") handOffs.delete(roomId);
      });
    })
  );
}
