import { inArray, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { users } from "../shared/schema.ts";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serializes every per-user writer on the `users` row, which exists for every
 * account whether or not the table being written has a row for it yet.
 *
 * `NO KEY UPDATE` because it conflicts with itself and with `deleteUser`, but
 * not with the `KEY SHARE` a foreign-key insert takes. `ORDER BY id` is what
 * keeps two writers locking the same set from deadlocking.
 */
export async function lockUsers(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(
    sql`SELECT id FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY id FOR NO KEY UPDATE`
  );
}
