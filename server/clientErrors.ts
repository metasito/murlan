// Client crash reports, kept long enough to be read on /admin.
//
// They already go to pino, which is where a crash is chased in the moment.
// This is the other reader: the owner, later, asking whether anyone got stuck
// — a question a log stream answers badly.
import { desc, gte, lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { clientErrors } from "../shared/schema.ts";

/** Matched to bug reports, and to nothing else here keeping personal data. */
export const CLIENT_ERROR_RETENTION_DAYS = 90;

/** No page of this table is unbounded; the table grows with every crash. */
export const CLIENT_ERROR_PAGE = 50;

export interface ClientErrorInput {
  userId: string | null;
  message: string;
  stack?: string;
  screen?: string;
  platform?: string;
  appVersion?: string;
  context?: Record<string, unknown>;
}

export interface ClientErrorRow {
  id: string;
  userId: string | null;
  occurredAt: Date;
  message: string;
  screen: string | null;
  platform: string | null;
  appVersion: string | null;
}

/**
 * Writes one report and prunes what has aged out, in the same transaction —
 * the shape `server/replays.ts` uses, so the table cannot grow without bound
 * if a scheduled prune is ever skipped or never written.
 */
export async function recordClientError(input: ClientErrorInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(clientErrors).values({
      userId: input.userId,
      message: input.message,
      stack: input.stack ?? null,
      screen: input.screen ?? null,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      context: input.context ?? {},
    });
    await tx
      .delete(clientErrors)
      .where(
        lt(
          clientErrors.occurredAt,
          sql`now() - make_interval(days => ${CLIENT_ERROR_RETENTION_DAYS})`
        )
      );
  });
}

/** The most recent reports, newest first. Bounded, and indexed on occurredAt. */
export async function recentClientErrors(limit = CLIENT_ERROR_PAGE): Promise<ClientErrorRow[]> {
  return db
    .select({
      id: clientErrors.id,
      userId: clientErrors.userId,
      occurredAt: clientErrors.occurredAt,
      message: clientErrors.message,
      screen: clientErrors.screen,
      platform: clientErrors.platform,
      appVersion: clientErrors.appVersion,
    })
    .from(clientErrors)
    .orderBy(desc(clientErrors.occurredAt))
    .limit(limit);
}

/** How many arrived in the last `days`, for the dashboard's one-line summary. */
export async function clientErrorCount(days: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clientErrors)
    .where(gte(clientErrors.occurredAt, sql`now() - make_interval(days => ${days})`));
  return row?.n ?? 0;
}
