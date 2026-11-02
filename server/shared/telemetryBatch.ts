// server/shared/telemetryBatch.ts — diagnostic rows (`events`, `client_errors`) written in batches.
// Nothing waits on them, so a row costs a slot in a bounded queue rather than its own commit, and
// a batch that fails costs its rows and a log line, nothing else (ADR 0014; D19 in
// docs/research/2026-11-01-system-audit/TICKETS.md).
import { pool } from "../store/db.ts";
import { logger } from "./logger.ts";

const FLUSH_MS = 1_000;
const BATCH_ROWS = 200;
const QUEUE_CAP = 5_000;
const FOREIGN_KEY_VIOLATION = "23503";

let dropped = 0;

/** Rows lost since boot: pushed out of a full queue, refused by the database, or for an account since deleted. */
export function telemetryRowsDropped(): number {
  return dropped;
}

export interface TelemetryTable<Row> {
  table: string;
  /**
   * One statement taking a column array per parameter, joined to `users` and keeping only rows
   * whose account still exists or that never had one: a row queued for an account deleted since
   * is not written, as the deletion's cascade would have removed it.
   */
  insert: string;
  columns: (rows: Row[]) => unknown[][];
}

/**
 * Text Postgres takes in `text` and `jsonb`. It refuses a NUL in both and a lone surrogate in
 * jsonb, and one row it refuses fails the statement for every row batched with it.
 */
export function telemetryText(text: string): string {
  return text.toWellFormed().replaceAll("\0", "");
}

/** `value` as jsonb text, each string in it through `telemetryText`. */
export function telemetryJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => (typeof inner === "string" ? telemetryText(inner) : inner));
}

interface Batch {
  flush(): Promise<void>;
}

const batches: Batch[] = [];

const codeOf = (err: unknown) => (err as { code?: unknown }).code;

/** A data exception or a constraint the rows broke: a fault in a row, not in the database. */
const rowAtFault = (err: unknown) => {
  const code = codeOf(err);
  return typeof code === "string" && (code.startsWith("22") || code.startsWith("23"));
};

/** How many of the rows were written. */
async function insertOnce(sql: string, values: unknown[][]): Promise<number> {
  try {
    return (await pool().query(sql, values)).rowCount ?? 0;
  } catch (err) {
    // The join read the account before it was deleted; read again, it drops the row.
    if (codeOf(err) !== FOREIGN_KEY_VIOLATION) throw err;
    return (await pool().query(sql, values)).rowCount ?? 0;
  }
}

/** A queue for one table: `add` never throws and never waits. */
export function telemetryBatch<Row>(spec: TelemetryTable<Row>): (row: Row) => void {
  const queue: Row[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;

  const write = async (rows: Row[]): Promise<void> => {
    try {
      dropped += rows.length - (await insertOnce(spec.insert, spec.columns(rows)));
    } catch (err) {
      if (rows.length > 1 && rowAtFault(err)) {
        for (const row of rows) await write([row]);
        return;
      }
      dropped += rows.length;
      logger.error({ err, table: spec.table, rows: rows.length }, "Failed to write a telemetry batch");
    }
  };

  const arm = () => {
    if (timer || queue.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void flush(true);
    }, FLUSH_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  // One batch in flight at a time: a stalled pool holds at most the cap plus one batch. A full
  // batch goes at once; what is left of one waits for the timer, or for a flush of everything.
  const flush = (all: boolean): Promise<void> => {
    if (all && timer) {
      clearTimeout(timer);
      timer = null;
    }
    const drain = async () => {
      while (queue.length >= BATCH_ROWS || (all && queue.length > 0)) await write(queue.splice(0, BATCH_ROWS));
    };
    // Started in this tick when nothing is in flight, so the batch leaves the queue before the cap can drop it.
    const run = flushing ? flushing.then(drain) : drain();
    flushing = run;
    void run.finally(() => {
      if (flushing === run) flushing = null;
      arm();
    });
    return run;
  };
  batches.push({ flush: () => flush(true) });

  return (row) => {
    if (queue.length >= QUEUE_CAP) {
      queue.shift();
      dropped++;
    }
    queue.push(row);
    if (queue.length >= BATCH_ROWS && !flushing) void flush(false);
    arm();
  };
}

/** Writes everything queued now; settles once it has landed or been dropped. Never rejects. */
export async function flushTelemetry(): Promise<void> {
  await Promise.all(batches.map((batch) => batch.flush()));
}
