import { inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { users } from "../shared/schema.ts";

/** Display names for the account ids given, skipping any that no longer exist. */
export async function namesOf(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.username]));
}
