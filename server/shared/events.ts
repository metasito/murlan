// Funnel steps: where people stop.
//
// `rooms.status` with no matching `round_history` already gives a rough
// "started but never finished" (#40). It cannot say that someone bounced off
// the lobby, or never made a move after sitting down. Those are steps, and a
// step that is not a finished game is recorded nowhere else.
//
// Written here, from the server, on the server's clock. A client-emitted event
// is telemetry the player can forge or block, and CLAUDE.md's server-authority
// rule is about what gets recorded as much as about who wins a round.
import { desc, sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { events } from "../../shared/schema.ts";
import { now } from "../http/clock.ts";
import { telemetryBatch, telemetryJson } from "./telemetryBatch.ts";
import type { EventContext, EventName } from "../../shared/events.ts";

/** Matched to client_errors, so the two age out together. */
export const EVENT_RETENTION_DAYS = 90;

/** Nothing on the dashboard reads further back than this. */
export const FUNNEL_WINDOW_DAYS = 30;

interface EventRow {
  name: EventName;
  userId: string | null;
  context: EventContext;
  occurredAt: string;
}

/** Retention is server/game/retention.ts's job, on a schedule — not this queue's. */
const queueEvent = telemetryBatch<EventRow>({
  table: "events",
  insert: `INSERT INTO events (user_id, occurred_at, name, context)
    SELECT u.id, t.occurred_at, t.name, t.context
    FROM unnest($1::text[], $2::timestamptz[], $3::text[], $4::jsonb[]) AS t(user_id, occurred_at, name, context)
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.user_id IS NULL OR u.id IS NOT NULL`,
  columns: (rows) => [
    rows.map((r) => r.userId),
    rows.map((r) => r.occurredAt),
    rows.map((r) => r.name),
    rows.map((r) => telemetryJson(r.context)),
  ],
});

/**
 * Fire-and-forget. This table is diagnostic and gameplay does not depend on
 * it, so a write that fails must cost a log line and nothing else — never a
 * rejected move, never a dropped socket, never a game that stops because the
 * analytics did.
 */
export function trackEvent(
  name: EventName,
  userId: string | null,
  context: EventContext = {}
): void {
  queueEvent({ name, userId, context, occurredAt: new Date(now()).toISOString() });
}

export interface FunnelStep {
  name: string;
  events: number;
  players: number;
}

/**
 * How many reached each step in the window, and how many distinct players did.
 * Both matter: one player rejoining twenty rooms is not twenty players getting
 * seated. Bounded by the window and covered by events_name_occurred_idx.
 */
export async function funnel(days = FUNNEL_WINDOW_DAYS): Promise<FunnelStep[]> {
  const rows = await db()
    .select({
      name: events.name,
      events: sql<number>`count(*)::int`,
      players: sql<number>`count(DISTINCT ${events.userId})::int`,
    })
    .from(events)
    .where(sql`${events.occurredAt} >= now() - make_interval(days => ${days})`)
    .groupBy(events.name)
    .orderBy(desc(sql`count(*)`));
  return rows;
}
