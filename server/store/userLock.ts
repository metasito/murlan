import { inArray, sql } from "drizzle-orm";
import type { Tx } from "./db.ts";
import { users } from "../../shared/schema.ts";

/**
 * Serializes every per-user writer on the `users` row, which exists for every
 * account whether or not the table being written has a row for it yet.
 *
 * `NO KEY UPDATE` because it conflicts with itself and with `deleteUser`, but
 * not with the `KEY SHARE` a foreign-key insert takes. `ORDER BY id` is what
 * keeps two writers locking the same set from deadlocking.
 *
 * Resolves to the ids it locked: an account deleted before the lock is absent, and stays
 * absent until the transaction ends.
 */
export async function lockUsers(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await tx.execute<{ id: string }>(
    sql`SELECT id FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY id FOR NO KEY UPDATE`
  );
  return new Set(rows.map((r) => r.id));
}
