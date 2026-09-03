// The /admin page, rendered here and served as HTML.
//
// Deliberately outside the design system: it is not player-facing, it has one
// reader, and none of its words go through `t()`. It is also never part of the
// app bundle — shipping admin code to every player's browser was rejected on
// #103 — which is the reason this renders a string rather than being a screen.
import type { AdminSnapshot } from "./admin.ts";
import { WINDOW_DAYS } from "./admin.ts";
import { CLIENT_ERROR_RETENTION_DAYS } from "./clientErrors.ts";
import { BUG_REPORT_RETENTION_DAYS } from "./bugReports.ts";

/**
 * Everything interpolated below goes through this. Nothing here is written by
 * a player today, but a dashboard is exactly where someone's chosen text ends
 * up eventually, and a page that escapes only what it currently needs to is a
 * page that stops escaping the day it grows a column.
 */
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function table(headers: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return `<p class="empty">No rows yet.</p>`;
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function panel(number: number, question: string, content: string): string {
  return `<section><h2>${number}. ${escapeHtml(question)}</h2>${content}</section>`;
}

/** Dense and legible, and nothing more — no fonts, no colours, no framework. */
const CSS = `
  body { font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; margin: 2rem; max-width: 60rem; }
  h1 { font-size: 1.2rem; }
  h2 { font-size: 1rem; margin: 1.6rem 0 .4rem; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: .15rem .5rem; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  .empty { color: #666; }
  .meta { color: #666; }
`;

export function renderAdminPage(snapshot: AdminSnapshot): string {
  const panels = [
    panel(
      1,
      "Signups over time",
      table(["Day", "Signups"], snapshot.signups.map((s) => [s.day, s.n]))
    ),
    panel(
      2,
      "Played today / this week",
      table(
        ["Window", "Distinct players"],
        [
          ["Today", snapshot.activeToday],
          ["This week", snapshot.activeThisWeek],
          ["Registered, all time", snapshot.totalUsers],
        ]
      )
    ),
    panel(
      3,
      "Retention cohorts",
      table(
        ["Week joined", "Joined", "Ever played"],
        snapshot.retention.map((r) => [r.cohort, r.joined, r.played])
      )
    ),
    panel(
      4,
      "Around but not playing",
      `<p>${snapshot.aroundNotPlaying} seen in the last 7 days with no finished match in that time.</p>`
    ),
    panel(
      5,
      "Ladder health",
      table(["Rating", "Players"], snapshot.ratings.map((r) => [r.bucket, r.n])) +
        `<p class="meta">${snapshot.provisionalPlayers} still provisional.</p>`
    ),
    panel(
      6,
      "Match balance",
      table(
        ["Players", "Matches", "Avg points"],
        snapshot.matchBalance.map((m) => [m.playerCount, m.matches, m.averagePoints])
      ) +
        table(["Placement", "Times"], snapshot.placements.map((p) => [p.placement, p.n]))
    ),
    panel(
      7,
      "Started but never finished",
      table(["Room status", "Rooms"], snapshot.unfinished.map((u) => [u.status, u.n])) +
        `<p>${snapshot.staleGames} game(s) saved but untouched for over a day.</p>`
    ),
    panel(
      8,
      "Where people drop out",
      table(
        ["Step", "Events", "Players"],
        snapshot.funnel.map((step) => [step.name, step.events, step.players])
      ) +
        `<p class="meta">A step that is not a finished game is recorded nowhere else. ` +
        `Account creation and finished games are deliberately absent — both are ` +
        `already derivable, and a second source of truth drifts from the first.</p>`
    ),
    panel(
      9,
      "Client crashes",
      `<p>${snapshot.crashesThisWeek} reported in the last 7 days.</p>` +
        table(
          ["Crash", "Count", "Last seen", "Location"],
          snapshot.crashGroups.map((g) => [g.message, g.count, g.lastSeen, g.location])
        ) +
        `<p class="meta">One row per distinct crash. Count and last-seen are ` +
        `over the ${CLIENT_ERROR_RETENTION_DAYS}-day retention window, not all-time.</p>`
    ),
    panel(
      10,
      "Mail health",
      table(
        ["Configured", "Attempted", "Succeeded", "Failed"],
        [[
          snapshot.mail.configured ? "yes" : "no",
          snapshot.mail.attempted,
          snapshot.mail.succeeded,
          snapshot.mail.failed,
        ]]
      ) +
        `<p class="meta">Since this process last started. "no" means verification and ` +
        `password-reset mail is silently a no-op — see the mail.sendFailed rows in ` +
        `"Where people drop out" above.</p>`
    ),
    panel(
      11,
      "Bug reports",
      table(
        ["When", "Who", "What they said", "Where", "Build"],
        snapshot.bugReports.map((r) => [r.at, r.who, r.description, r.where, r.build])
      ) +
        `<p class="meta">A player's own words, newest first, kept for ` +
        `${BUG_REPORT_RETENTION_DAYS} days. No game state is collected.</p>`
    ),
  ].join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Murlan admin</title><style>${CSS}</style></head>
<body>
<h1>Murlan</h1>
<p class="meta">Generated ${escapeHtml(snapshot.generatedAt)} · counts over the last ${WINDOW_DAYS} days unless stated.</p>
${panels}
</body></html>`;
}
