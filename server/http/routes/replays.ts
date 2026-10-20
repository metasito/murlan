import type { Express } from "express";
import { onSignedIn } from "../mount.ts";
import { readParam } from "../validate.ts";
import { getReplayForUser, listReplaysForUser } from "../../game/replays.ts";
import { payload } from "../../shared/payload.ts";

// Both reads are scoped to the caller's own seats: the query filters on
// player_ids, so an id lifted from somewhere else returns 404 rather than a
// stranger's game. A replay holds no hand, only what was played.
export function mountReplays(app: Express): void {
  onSignedIn(app, "GET /api/replays", async (_req, res, userId) => {
    res.json(await listReplaysForUser(userId));
  });

  onSignedIn(app, "GET /api/replays/:id", async (req, res, userId) => {
    const id = readParam(res, req.params.id);
    if (id === null) return;
    const replay = await getReplayForUser(id, userId);
    if (!replay) {
      res.status(404).json({ ...payload("REPLAY_NOT_FOUND") });
      return;
    }
    res.json(replay);
  });
}
