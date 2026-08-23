// Client crash reports, kept long enough to be read on /admin.
//
// They already go to pino, which is where a crash is chased in the moment.
// This is the other reader: the owner, later, asking whether anyone got stuck
// — a question a log stream answers badly.
import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
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

export interface ClientErrorGroup {
  fingerprint: string | null;
  message: string;
  count: number;
  lastSeen: Date;
  stack: string | null;
}

/**
 * The frame that actually identifies where a crash broke: the first line
 * that looks like a stack entry (V8's `at fn (file:line:col)`, or Hermes'
 * `fn@file:line:col`), skipping a leading "Error: <message>" echo line.
 */
export function topFrame(stack: string | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^at\s/.test(l) || /@.*:\d+:\d+/.test(l)) ?? lines[1] ?? lines[0] ?? "";
}

/**
 * Same idea Sentry documents for stack-trace grouping: a content-hashed
 * bundle filename and the byte offsets a single minified file encodes as
 * line:col both change on every deploy, so they're collapsed to one
 * placeholder rather than left to fingerprint every redeploy as a new crash.
 */
function normalizeForFingerprint(text: string): string {
  return text.replace(/[a-f0-9]{6,}/gi, "#").replace(/\d+/g, "#");
}

/** Computed server-side, over data the server already has — never accepted from the client. */
function computeFingerprint(message: string, stack: string | undefined): string {
  const basis = normalizeForFingerprint(`${message}\n${topFrame(stack)}`);
  return createHash("sha256").update(basis).digest("hex");
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
      fingerprint: computeFingerprint(input.message, input.stack),
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

/**
 * One row per distinct crash instead of one per event, newest activity
 * first. Grouped by fingerprint — except rows with none (written before this
 * column existed), which GROUP BY would otherwise collapse into a single
 * "unknown" bucket since Postgres treats every NULL as equal; `id` stands in
 * as each of those rows' own group instead, so none are hidden.
 */
export async function recentClientErrorGroups(limit = CLIENT_ERROR_PAGE): Promise<ClientErrorGroup[]> {
  const rows = await db.execute<{
    fingerprint: string | null;
    message: string;
    count: number;
    lastSeen: Date;
    stack: string | null;
  }>(sql`
    SELECT
      min(fingerprint) AS fingerprint,
      (array_agg(message ORDER BY occurred_at DESC))[1] AS message,
      count(*)::int AS count,
      max(occurred_at) AS "lastSeen",
      (array_agg(stack ORDER BY occurred_at DESC))[1] AS stack
    FROM client_errors
    GROUP BY coalesce(fingerprint, id::text)
    ORDER BY "lastSeen" DESC
    LIMIT ${limit}
  `);
  return rows.rows;
}
