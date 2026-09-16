import { test } from "node:test";
import assert from "node:assert/strict";
import { routeMountings } from "./helpers/routeMountings.ts";

/** Answered to a signed-out caller on purpose: they are how one signs in, or they read the session themselves. */
const PUBLIC = [
  "POST /api/auth/register",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/auth/me",
  "POST /api/auth/verify-email",
  "POST /api/auth/request-password-reset",
  "POST /api/auth/reset-password",
];

const SIGNED_IN = [
  "POST /api/push/token",
  "DELETE /api/push/token",
  "POST /api/auth/change-password",
  "POST /api/auth/add-email",
  "POST /api/auth/resend-verification",
  "POST /api/auth/socket-ticket",
  "PATCH /api/users/me",
  "POST /api/users/me/tutorial-seen",
  "DELETE /api/users/me",
  "GET /api/friends",
  "GET /api/friends/requests",
  "GET /api/friends/invites",
  "DELETE /api/friends/invites/:roomCode",
  "GET /api/users/search",
  "GET /api/friends/sent",
  "POST /api/friends/add",
  "DELETE /api/friends/requests/:id",
  "POST /api/friends/accept/:id",
  "POST /api/friends/decline/:id",
  "DELETE /api/friends/:friendUserId",
  "GET /api/stats/me",
  "GET /api/stats/history",
  "GET /api/ratings/me",
  "GET /api/ratings/leaderboard",
  "GET /api/replays",
  "GET /api/replays/:id",
  "POST /api/client-errors",
  "POST /api/bug-reports",
  "GET /api/stats/achievements",
];

const ADMIN = ["GET /admin"];

const sorted = (list: string[]) => [...list].sort();

test("the scan finds exactly the routes written here", () => {
  assert.deepEqual(
    sorted(routeMountings().map((m) => m.route)),
    sorted([...PUBLIC, ...SIGNED_IN, ...ADMIN]),
    "a route was added, removed or stopped being a literal path — place it in one of the lists above"
  );
});

test("every route names its guard, unless it is public on purpose", () => {
  const mountings = routeMountings();
  const naming = (guard: string) =>
    sorted(mountings.filter((m) => m.middleware.includes(guard)).map((m) => m.route));
  const unguarded = mountings
    .filter((m) => !m.middleware.includes("requireAuth") && !m.middleware.includes("requireAdmin"))
    .map((m) => m.route);

  assert.deepEqual(naming("requireAuth"), sorted(SIGNED_IN));
  assert.deepEqual(naming("requireAdmin"), sorted(ADMIN));
  assert.deepEqual(sorted(unguarded), sorted(PUBLIC));
});
