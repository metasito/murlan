/**
 * Local end-to-end stack: an empty Postgres in Docker for the server to use.
 *
 * Usage:
 *   node scripts/dev-stack.mjs up     start Postgres
 *   node scripts/dev-stack.mjs down   stop and remove the container
 *   node scripts/dev-stack.mjs env    print the env vars for the server
 *
 * It creates no tables. `server/schemaDdl.ts` is the single owner of that, and
 * it runs on every server start against whatever database it is pointed at.
 *
 * The container is disposable and named distinctly so it can never be confused
 * with a real database.
 */
import { execFileSync, spawnSync } from "node:child_process";

const NAME = "murlan-dev-pg";
// Overridable so this container's port never collides with another Postgres
// already holding 55432 — e.g. the integration suites' own disposable
// container — when both need to run at once.
const PORT = Number(process.env.MURLAN_DEV_PG_PORT ?? 55432);
const URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/murlan_dev`;

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

function isRunning() {
  const r = run("docker", ["ps", "-q", "-f", `name=^${NAME}$`]);
  return r.stdout.trim().length > 0;
}

function waitReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = run("docker", ["exec", NAME, "pg_isready", "-U", "postgres"]);
    if (r.status === 0) return true;
    execFileSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
  }
  return false;
}

const cmd = process.argv[2] ?? "up";

if (cmd === "env") {
  console.log(`DATABASE_URL=${URL}`);
  console.log("SESSION_SECRET=local-dev-secret");
  process.exit(0);
}

if (cmd === "down") {
  run("docker", ["rm", "-f", NAME]);
  console.log("stopped");
  process.exit(0);
}

if (!isRunning()) {
  run("docker", ["rm", "-f", NAME]);
  const r = run("docker", [
    "run", "-d", "--name", NAME,
    "-e", "POSTGRES_USER=postgres",
    "-e", "POSTGRES_PASSWORD=postgres",
    "-e", "POSTGRES_DB=murlan_dev",
    "-p", `${PORT}:5432`,
    "postgres:16-alpine",
  ]);
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
}

if (!waitReady()) {
  console.error("Postgres did not become ready");
  process.exit(1);
}

console.log(`ready on ${URL}`);
