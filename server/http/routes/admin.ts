import type { Express } from "express";
import { requireAdmin } from "../access.ts";
import { adminSnapshot } from "../admin.ts";
import { renderAdminPage } from "../adminPage.ts";
import { runningCommitSha } from "../buildInfo.ts";
import { logger } from "../logger.ts";
import { PROVISIONAL_ROUNDS } from "../../game/ratings.ts";

// Server-rendered on purpose. This is never part of the app bundle, so no
// admin code reaches a player's browser (#103). Plain `app.get`, never the
// contract: shared/http.ts reaches the client's types, and /admin is not to be
// named there.
export function mountAdmin(app: Express): void {
  app.get("/admin", requireAdmin, async (_req, res) => {
    try {
      const snapshot = await adminSnapshot(PROVISIONAL_ROUNDS);
      res.type("html").send(renderAdminPage(snapshot));
    } catch (err) {
      logger.error({ err }, "Failed to build the admin snapshot");
      res.status(500).type("text/plain").send("Snapshot failed");
    }
  });

  app.get("/api/admin/version", requireAdmin, (_req, res) => {
    res.json({ env: process.env.NODE_ENV, commit: runningCommitSha });
  });
}
