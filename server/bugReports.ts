// What a player says is wrong, in their own words.
//
// `POST /api/client-errors` catches a crash. This catches the far more common
// thing a crash never sees: "this looks wrong", "I got stuck", "the cards went
// weird" — which has otherwise no path off the device at all.
//
// Everything stored here is the reporter's own: their words, the route they
// were on, and what their build is. No game state and no attached crash, both
// of which carry other players' data and wait on a privacy policy.
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import { bugReports } from "../shared/schema.ts";

/** Matched to `CLIENT_ERROR_RETENTION_DAYS`; both hold personal data. */
export const BUG_REPORT_RETENTION_DAYS = 90;

/** No page of this table is unbounded; it grows with every report. */
export const BUG_REPORT_PAGE = 50;

/**
 * Caps, in characters. Enforced by zod on the way in
 * (`BugReportSchema`, server/schemas.ts) rather than by the field's
 * `maxLength` — a client is not the thing to trust with the size of what it
 * sends.
 */
export const BUG_REPORT_LIMITS = {
  description: 2000,
  screen: 200,
  appVersion: 50,
  platform: 50,
  locale: 20,
} as const;

export interface BugReportInput {
  userId: string;
  description: string;
  screen?: string;
  appVersion?: string;
  platform?: string;
  locale?: string;
}

export interface BugReportRow {
  id: string;
  createdAt: Date;
  username: string | null;
  description: string;
  screen: string | null;
  appVersion: string | null;
  platform: string | null;
  locale: string | null;
  resolved: boolean;
}

/** Writes one report. Retention is server/retention.ts's job, on a schedule. */
export async function recordBugReport(input: BugReportInput): Promise<void> {
  await db.insert(bugReports).values({
    userId: input.userId,
    description: input.description,
    screen: input.screen ?? null,
    appVersion: input.appVersion ?? null,
    platform: input.platform ?? null,
    locale: input.locale ?? null,
  });
}

/** Newest first, for /admin. The reporter's name, so a reply is possible by hand. */
export async function recentBugReports(limit = BUG_REPORT_PAGE): Promise<BugReportRow[]> {
  const rows = await db.execute<{
    id: string;
    created_at: Date;
    username: string | null;
    description: string;
    screen: string | null;
    app_version: string | null;
    platform: string | null;
    locale: string | null;
    resolved: boolean;
  }>(sql`
    SELECT b.id, b.created_at, u.username, b.description, b.screen,
           b.app_version, b.platform, b.locale, b.resolved
      FROM bug_reports b
      LEFT JOIN users u ON u.id = b.user_id
     ORDER BY b.created_at DESC
     LIMIT ${limit}
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    username: r.username,
    description: r.description,
    screen: r.screen,
    appVersion: r.app_version,
    platform: r.platform,
    locale: r.locale,
    resolved: r.resolved,
  }));
}
