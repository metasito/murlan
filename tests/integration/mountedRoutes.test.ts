// tests/server/routesAuthenticated.test.ts walks the API alone; this walks the app as
// createApp() builds it, so a route mounted outside the API's files is seen too.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { mountedRoutes } from "../helpers/mountedRoutes.ts";
import { HTTP } from "../../shared/http.ts";

/** Every route outside the player API, each answered on purpose without the contract. */
const NON_API = new Set([
  "GET /health",
  "GET /.well-known/apple-app-site-association",
  "GET /.well-known/assetlinks.json",
  "GET /admin",
  "GET /api/admin/version",
  // configureWebBuild mounts one or the other, as dist/ exists or not.
  "GET *path",
  "GET /",
]);

/** Every `app.use` middleware createApp mounts, by function name; each passes a request on or answers only its own concern. */
const PASS_THROUGH = new Set([
  "helmetMiddleware",
  // pino-http's request logger.
  "result",
  "corsHeaders",
  "jsonParser",
  "urlencodedParser",
  "compression",
  "session",
  "refuseSourceMaps",
  "serveStatic",
  "errorHandler",
]);

let server: TestServer;
before(async () => { if (hasDatabase()) server = await startTestServer(); });
after(async () => { if (server) await server.stop(); });

describe("the live app's routes", { skip: hasDatabase() ? false : skipMessage() }, () => {
  test("every route is the contract's or in the explicit non-API list, and /health was seen", () => {
    const routes = mountedRoutes(server.app, PASS_THROUGH).map((m) => m.route);
    const contract = new Set(Object.keys(HTTP));

    assert.ok(routes.includes("GET /health"), "the walk never saw /health — it is not reading the live app");
    assert.deepEqual(routes.filter((r) => !contract.has(r) && !NON_API.has(r)), [], "a route in neither list");
    assert.deepEqual([...contract].filter((r) => !routes.includes(r)), [], "a contract route the app never mounted");
  });
});
