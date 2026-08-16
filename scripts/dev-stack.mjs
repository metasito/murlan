/**
 * Local end-to-end stack: Postgres in Docker, schema pushed, server running.
 *
 * Usage:
 *   node scripts/dev-stack.mjs up     start Postgres and push the schema
 *   node scripts/dev-stack.mjs down   stop and remove the container
 *   node scripts/dev-stack.mjs env    print the env vars for the server
 *
 * The container is disposable and named distinctly so it can never be confused
 * with a real database.
 */
import { execFileSync, spawnSync } from "node:child_process";

const NAME = "murlan-dev-pg";
const PORT = 55432;
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

const push = run("npx", ["drizzle-kit", "push", "--force"], {
  env: { ...process.env, DATABASE_URL: URL },
  shell: process.platform === "win32",
});
process.stdout.write(push.stdout ?? "");
if (push.status !== 0) {
  process.stderr.write(push.stderr ?? "");
  process.exit(1);
}

// connect-pg-simple's table, not Drizzle's, so `drizzle-kit push` never creates
// it. On Replit it is pre-created; locally the stack has to make it.
const sessionDdl = `
  CREATE TABLE IF NOT EXISTS session (
    sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
    sess json NOT NULL,
    expire timestamp(6) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);
`;
const sess = run("docker", ["exec", "-i", NAME, "psql", "-U", "postgres", "-d", "murlan_dev", "-c", sessionDdl]);
if (sess.status !== 0) {
  console.error(sess.stderr);
  process.exit(1);
}

console.log(`ready on ${URL}`);
