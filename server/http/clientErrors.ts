// Client crash reports, kept long enough to be read on /admin.
//
// They already go to pino, which is where a crash is chased in the moment.
// This is the other reader: the owner, later, asking whether anyone got stuck
// — a question a log stream answers badly.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { telemetryBatch, telemetryJson, telemetryText } from "../shared/telemetryBatch.ts";
import { now } from "./clock.ts";
import { ERROR_GROUP_WINDOW_DAYS } from "./serverErrors.ts";

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
  lastSeen: string;
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

interface ClientErrorRow {
  userId: string | null;
  occurredAt: string;
  appVersion: string | null;
  platform: string | null;
  screen: string | null;
  message: string;
  stack: string | null;
  context: string;
  fingerprint: string;
}

const queueClientError = telemetryBatch<ClientErrorRow>({
  table: "client_errors",
  insert: `INSERT INTO client_errors
      (user_id, occurred_at, app_version, platform, screen, message, stack, context, fingerprint)
    SELECT u.id, t.occurred_at, t.app_version, t.platform, t.screen, t.message, t.stack, t.context, t.fingerprint
    FROM unnest(
      $1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::jsonb[], $9::text[]
    ) AS t(user_id, occurred_at, app_version, platform, screen, message, stack, context, fingerprint)
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.user_id IS NULL OR u.id IS NOT NULL`,
  columns: (rows) => [
    rows.map((r) => r.userId),
    rows.map((r) => r.occurredAt),
    rows.map((r) => r.appVersion),
    rows.map((r) => r.platform),
    rows.map((r) => r.screen),
    rows.map((r) => r.message),
    rows.map((r) => r.stack),
    rows.map((r) => r.context),
    rows.map((r) => r.fingerprint),
  ],
});

const optional = (text: string | undefined) => (text === undefined ? null : telemetryText(text));

/** Queues one report. Retention is server/game/retention.ts's job, on a schedule. */
export function recordClientError(input: ClientErrorInput): void {
  const message = telemetryText(input.message);
  const stack = optional(input.stack);
  queueClientError({
    userId: input.userId,
    occurredAt: new Date(now()).toISOString(),
    appVersion: optional(input.appVersion),
    platform: optional(input.platform),
    screen: optional(input.screen),
    message,
    stack,
    context: telemetryJson(input.context ?? {}),
    fingerprint: computeFingerprint(message, stack ?? undefined),
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
  const rows = await db().execute<{
    fingerprint: string | null;
    message: string;
    count: number;
    lastSeen: string;
    stack: string | null;
  }>(sql`
    SELECT
      min(fingerprint) AS fingerprint,
      (array_agg(message ORDER BY occurred_at DESC))[1] AS message,
      count(*)::int AS count,
      max(occurred_at) AS "lastSeen",
      (array_agg(stack ORDER BY occurred_at DESC))[1] AS stack
    FROM client_errors
    WHERE occurred_at >= now() - make_interval(days => ${ERROR_GROUP_WINDOW_DAYS})
    GROUP BY coalesce(fingerprint, id::text)
    ORDER BY "lastSeen" DESC
    LIMIT ${limit}
  `);
  return rows.rows;
}
