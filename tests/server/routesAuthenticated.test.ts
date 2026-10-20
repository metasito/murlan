import { test } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { z } from "zod";
import { mountedRoutes } from "../helpers/mountedRoutes.ts";
import { mountApi } from "../../server/http/routes/index.ts";
import { requireAdmin, requireAuth } from "../../server/http/access.ts";
import { on, onSignedIn } from "../../server/http/mount.ts";
import { validate } from "../../server/http/validate.ts";
import { HTTP } from "../../shared/http.ts";
import { LoginSchema, RegisterSchema } from "../../shared/httpSchemas.ts";

/** Answered to a signed-out caller on purpose: they are how one signs in. */
const PUBLIC = [
  "POST /api/auth/register",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/verify-email",
  "POST /api/auth/request-password-reset",
  "POST /api/auth/reset-password",
];

const SIGNED_IN = [
  "POST /api/push/token",
  "GET /api/auth/me",
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
  "GET /api/ratings/leaderboard/friends",
  "GET /api/replays",
  "GET /api/replays/:id",
  "POST /api/client-errors",
  "POST /api/bug-reports",
  "GET /api/stats/achievements",
];

const ADMIN = ["GET /admin", "GET /api/admin/version"];

const sorted = (list: string[]) => [...list].sort();
const noop: RequestHandler = (_req, _res, next) => next();

function api() {
  const app = express();
  mountApi(app);
  return mountedRoutes(app);
}

test("the walker reads routes from the live router, and refuses a nested one (positive control)", () => {
  const app = express();
  app.use(noop);
  app.get("/a", requireAuth, noop);
  app.post("/b/:id", noop);
  assert.deepEqual(mountedRoutes(app, new Set(["noop"])), [
    { route: "GET /a", handles: [requireAuth, noop] },
    { route: "POST /b/:id", handles: [noop] },
  ]);
  assert.throws(() => mountedRoutes(app), /"noop" is not a known pass-through/);

  const answering = express();
  answering.use("/api/x", (_req, res) => {
    res.send();
  });
  assert.throws(() => mountedRoutes(answering, new Set(["noop"])), /"<anonymous>" is not a known pass-through/);

  const nested = express();
  nested.use("/x", express.Router().get("/y", noop));
  assert.throws(() => mountedRoutes(nested), /nested Router/);
});

test("the mounted routes are exactly the ones written here", () => {
  const found = api().map((m) => m.route);
  assert.ok(found.length >= 38, `only ${found.length} routes found — the walk has stopped seeing them`);
  assert.deepEqual(
    sorted(found),
    sorted([...PUBLIC, ...SIGNED_IN, ...ADMIN]),
    "a route was added or removed — place it in one of the lists above"
  );
});

test("every route's first layer is its guard, unless it is public on purpose", () => {
  const routes = api();
  const guardedBy = (guard: unknown) => sorted(routes.filter((m) => m.handles[0] === guard).map((m) => m.route));
  const unguarded = routes.filter((m) => !m.handles.includes(requireAuth) && !m.handles.includes(requireAdmin));

  assert.deepEqual(guardedBy(requireAuth), sorted(SIGNED_IN));
  assert.deepEqual(guardedBy(requireAdmin), sorted(ADMIN));
  assert.deepEqual(sorted(unguarded.map((m) => m.route)), sorted(PUBLIC));
});

test("the mounted player API equals the HTTP contract, both ways", () => {
  const mounted = api()
    .map((m) => m.route)
    .filter((r) => !ADMIN.includes(r));
  const contract = Object.keys(HTTP);
  assert.deepEqual(mounted.filter((r) => !contract.includes(r)), [], "mounted, but not in shared/http.ts");
  assert.deepEqual(contract.filter((r) => !mounted.includes(r)), [], "in shared/http.ts, but never mounted");
  assert.ok(mounted.every((r) => r.split(" ")[1]!.startsWith("/api/")));
});

test("on refuses a chain that does not validate the contract's body schema", () => {
  const app = express();
  assert.throws(() => on(app, "POST /api/auth/login", noop, () => {}), /no layer of its chain validates/);
  assert.throws(
    () => on(app, "POST /api/auth/login", validate(RegisterSchema), () => {}),
    /no layer of its chain validates/
  );
  assert.throws(
    () => onSignedIn(app, "POST /api/auth/socket-ticket", validate(z.object({})), () => {}),
    /HTTP does not name/
  );
  assert.throws(() => onSignedIn(app, "GET /api/users/search", () => {}), /query schema that no layer/);
  on(app, "POST /api/auth/login", noop, validate(LoginSchema), () => {});
  assert.deepEqual(
    mountedRoutes(app).map((m) => m.route),
    ["POST /api/auth/login"],
    "a chain that validates the contract's schema mounts"
  );
});

test("onSignedIn mounts requireAuth ahead of the whole chain", () => {
  const app = express();
  onSignedIn(app, "GET /api/friends", noop, () => {});
  const [mounted] = mountedRoutes(app);
  assert.equal(mounted?.handles[0], requireAuth);
  assert.equal(mounted?.handles[1], noop);
  assert.equal(mounted?.handles.length, 3);
});
