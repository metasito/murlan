/**
 * Boots the exact stack the E2E suite drives: the disposable Postgres dev
 * stack, a fresh Expo web build, and the real Express server serving both —
 * the same `dist/` + API split Replit runs in production (server/app.ts
 * `configureExpoAndLanding`). Playwright's `webServer` config invokes this
 * directly; `npm run test:e2e` does not need its own orchestration.
 *
 * Set E2E_SKIP_BUILD=1 to reuse an existing dist/ build across repeated
 * local runs — the suite itself never sets it, so CI always builds fresh.
 *
 * EXPO_PUBLIC_E2E_FAST=1 is set before the build so app/game.tsx and
 * app/(online)/game.tsx bake in a zero-delay AI/result pacing instead of
 * their production values (EXPO_PUBLIC_ vars are inlined at bundle build
 * time, not read at runtime — production builds never set this, so their
 * pacing is untouched). The AFK/disconnect-grace timers are the server's
 * own existing env knobs (server/socket.ts), shortened the same way.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBundleHasRoutes } from "./bundleRoutes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.E2E_PORT ?? "5199";
const DEV_STACK = path.join(ROOT, "scripts", "dev-stack.mjs");

function run(cmd, args, useShell) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: useShell });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${result.status}`);
  }
}

/**
 * Where the dev stack actually put Postgres, asked rather than recomputed.
 *
 * The container moves to another port when something else already holds the
 * default (#580, and the CI shard that died for it), so a URL built here from
 * the same environment `up` started with can name a port nothing is listening
 * on. `dev-stack env` reads it back off the running container.
 */
function databaseUrl() {
  const r = spawnSync(process.execPath, [DEV_STACK, "env"], { cwd: ROOT, encoding: "utf8" });
  const url = (r.stdout ?? "").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (r.status !== 0 || !url) {
    throw new Error(`dev-stack env did not report a database: ${r.stderr || r.stdout}`);
  }
  return url;
}

process.env.EXPO_PUBLIC_E2E_FAST = "1";
process.env.MURLAN_AFK_TIMEOUT_MS ??= "5000";
process.env.MURLAN_DISCONNECT_GRACE_MS ??= "5000";

run(process.execPath, [DEV_STACK, "up"]);

if (process.env.E2E_SKIP_BUILD !== "1" || !existsSync(path.join(ROOT, "dist", "index.html"))) {
  run(process.platform === "win32" ? "npx.cmd" : "npx", ["expo", "export", "--platform", "web"], process.platform === "win32");
}

assertBundleHasRoutes(path.join(ROOT, "dist"), path.join(ROOT, "app"));

process.env.DATABASE_URL = databaseUrl();
process.env.SESSION_SECRET = "e2e-test-secret";
process.env.PORT = PORT;

run(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", path.join(ROOT, "server", "index.ts")],
  process.platform === "win32"
);
