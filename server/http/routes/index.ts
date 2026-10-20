import type { Express } from "express";
import { mountAuth } from "./auth.ts";
import { mountAccount } from "./account.ts";
import { mountFriends } from "./friends.ts";
import { mountProfile } from "./profile.ts";
import { mountAdmin } from "./admin.ts";
import { mountReplays } from "./replays.ts";
import { mountReports } from "./reports.ts";

/** Every route under /api, and /admin. Each JSON error body carries a stable `code` the client localises by. */
export function mountApi(app: Express): void {
  mountAuth(app);
  mountAccount(app);
  mountFriends(app);
  mountProfile(app);
  mountAdmin(app);
  mountReplays(app);
  mountReports(app);
}
