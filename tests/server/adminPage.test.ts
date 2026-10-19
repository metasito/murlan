import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAdminPage } from "../../server/http/adminPage.ts";
import type { AdminSnapshot } from "../../server/http/admin.ts";
import { ERROR_GROUP_WINDOW_DAYS } from "../../server/http/serverErrors.ts";

const snapshot: AdminSnapshot = {
  generatedAt: new Date(0).toISOString(),
  signups: [],
  totalUsers: 0,
  activeToday: 0,
  activeThisWeek: 0,
  retention: [],
  aroundNotPlaying: 0,
  ratings: [],
  provisionalPlayers: 0,
  matchBalance: [],
  placements: [],
  unfinished: [],
  staleGames: 0,
  crashesThisWeek: 0,
  crashGroups: [],
  serverErrorsThisWeek: 0,
  serverErrorGroups: [],
  bugReports: [],
  funnel: [],
  mail: { configured: true, attempted: 0, succeeded: 0, failed: 0 },
};

function panelText(html: string, title: string): string {
  const at = html.indexOf(title);
  assert.ok(at >= 0, `no "${title}" panel`);
  const next = html.indexOf("<h2", at);
  return html.slice(at, next < 0 ? undefined : next);
}

test("both error panels state the window their groups are counted over", () => {
  const html = renderAdminPage(snapshot);
  for (const title of ["Client crashes", "Server errors"]) {
    const text = panelText(html, title);
    assert.match(text, new RegExp(`Count and last-seen are over the last ${ERROR_GROUP_WINDOW_DAYS} days`), `${title}: ${text}`);
    assert.doesNotMatch(text, /Count and last-seen are over the 90-day/, title);
  }
});
