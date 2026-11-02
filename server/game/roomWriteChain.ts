// server/game/roomWriteChain.ts — the order a table's writes land in. Only the instance that owns a
// table writes for it, so an in-process order is the whole order (ADR 0014, decision 2).
//
// A snapshot supersedes the one before it, so a newer one replaces a snapshot still waiting; a
// barrier (a delete, a status write) is never replaced and nothing overtakes it.

interface Entry {
  kind: "snapshot" | "barrier";
  write: () => Promise<void>;
  started: boolean;
  landed: Promise<void>;
  land: () => void;
}

const queues = new Map<string, Entry[]>();

function entry(kind: Entry["kind"], write: () => Promise<void>): Entry {
  let land!: () => void;
  const landed = new Promise<void>((resolve) => (land = resolve));
  return { kind, write, started: false, landed, land };
}

async function drain(roomId: string, queue: Entry[]): Promise<void> {
  for (let next = queue[0]; next; next = queue[0]) {
    next.started = true;
    await next.write().catch(() => {});
    queue.shift();
    next.land();
  }
  queues.delete(roomId);
}

function enqueue(roomId: string, next: Entry): void {
  const queue = queues.get(roomId);
  if (queue) {
    queue.push(next);
    return;
  }
  const fresh = [next];
  queues.set(roomId, fresh);
  void drain(roomId, fresh);
}

/**
 * Queues the room's latest snapshot. Settles once it, or a newer snapshot that replaced it, has
 * been written; never rejects.
 */
export function queueSnapshot(roomId: string, write: () => Promise<void>): Promise<void> {
  const last = queues.get(roomId)?.at(-1);
  if (last && last.kind === "snapshot" && !last.started) {
    last.write = write;
    return last.landed;
  }
  const next = entry("snapshot", write);
  enqueue(roomId, next);
  return next.landed;
}

/** Queues a write that runs after everything queued before it and before everything after. Settles as `write` does. */
export function queueBarrier<T>(roomId: string, write: () => Promise<T>): Promise<T> {
  let settle!: Promise<T>;
  const next = entry("barrier", () => {
    settle = (async () => write())();
    return settle.then(() => {});
  });
  enqueue(roomId, next);
  return next.landed.then(() => settle);
}

const NOTHING_QUEUED = Promise.resolve();

/** Settles once every write queued for the room so far has landed; the same promise until another is queued. */
export function roomWritesLanded(roomId: string): Promise<void> {
  return queues.get(roomId)?.at(-1)?.landed ?? NOTHING_QUEUED;
}

/** Settles once every write queued for any room so far has landed. */
export async function allRoomWritesLanded(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.at(-1)?.landed));
}
