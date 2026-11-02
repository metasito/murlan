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

/** Rows lost since boot: pushed out of a full queue, or in a batch that failed. */
export function telemetryRowsDropped(): number {
  return dropped;
}

export interface TelemetryTable<Row> {
  table: string;
  /**
   * One statement taking a column array per parameter, joined to `users` so an account deleted
   * since the row was queued writes a null `user_id` instead of failing the batch.
   */
  insert: string;
  columns: (rows: Row[]) => unknown[][];
}

interface Batch {
  flush(): Promise<void>;
}

const batches: Batch[] = [];

async function insertOnce(sql: string, values: unknown[][]): Promise<void> {
  try {
    await pool().query(sql, values);
  } catch (err) {
    // The join read the account before it was deleted; read again, it writes null.
    if ((err as { code?: unknown }).code !== FOREIGN_KEY_VIOLATION) throw err;
    await pool().query(sql, values);
  }
}

/** A queue for one table: `add` never throws and never waits. */
export function telemetryBatch<Row>(spec: TelemetryTable<Row>): (row: Row) => void {
  const queue: Row[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;

  const write = async (rows: Row[]) => {
    try {
      await insertOnce(spec.insert, spec.columns(rows));
    } catch (err) {
      dropped += rows.length;
      logger.error({ err, table: spec.table, rows: rows.length }, "Failed to write a telemetry batch");
    }
  };

  const drain = async () => {
    while (queue.length > 0) await write(queue.splice(0, BATCH_ROWS));
  };

  // One batch in flight at a time: a stalled pool holds at most the cap plus one batch.
  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flushing ??= drain().finally(() => {
      flushing = null;
    });
    return flushing;
  };
  batches.push({ flush });

  return (row) => {
    if (queue.length >= QUEUE_CAP) {
      queue.shift();
      dropped++;
    }
    queue.push(row);
    if (queue.length >= BATCH_ROWS) {
      void flush();
    } else if (!timer) {
      timer = setTimeout(() => void flush(), FLUSH_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  };
}

/** Writes everything queued now; settles once it has landed or been dropped. Never rejects. */
export async function flushTelemetry(): Promise<void> {
  await Promise.all(batches.map((batch) => batch.flush()));
}
