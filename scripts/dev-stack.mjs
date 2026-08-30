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
import { hostPortOf, startOnFreePort } from "./devStackPort.mjs";

const NAME = "murlan-dev-pg";
const DEFAULT_PORT = 55432;
const requested = process.env.MURLAN_DEV_PG_PORT;
const BASE_PORT = Number(requested ?? DEFAULT_PORT);
const urlFor = (port) => `postgres://postgres:postgres@127.0.0.1:${port}/murlan_dev`;

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

function isRunning() {
  const r = run("docker", ["ps", "-q", "-f", `name=^${NAME}$`]);
  return r.stdout.trim().length > 0;
}

/**
 * Where the container is, asked of Docker rather than assumed from the
 * environment. `up` may have settled on a port other than the base one, and
 * `env` runs as its own process with no memory of that; the daemon is the only
 * party that cannot be out of date about its own container.
 */
function publishedPort() {
  if (!isRunning()) return null;
  const r = run("docker", ["port", NAME, "5432"]);
  return r.status === 0 ? hostPortOf(r.stdout) : null;
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
  console.log(`DATABASE_URL=${urlFor(publishedPort() ?? BASE_PORT)}`);
  console.log("SESSION_SECRET=local-dev-secret");
  process.exit(0);
}

if (cmd === "down") {
  run("docker", ["rm", "-f", NAME]);
  console.log("stopped");
  process.exit(0);
}

let port = publishedPort();
if (port === null) {
  run("docker", ["rm", "-f", NAME]);
  try {
    port = startOnFreePort({
      start: BASE_PORT,
      explicit: requested !== undefined,
      run: (p) => {
        const r = run("docker", [
          "run", "-d", "--name", NAME,
          "-e", "POSTGRES_USER=postgres",
          "-e", "POSTGRES_PASSWORD=postgres",
          "-e", "POSTGRES_DB=murlan_dev",
          "-p", `${p}:5432`,
          "postgres:16-alpine",
        ]);
        // A run that got far enough to bind and then failed leaves the
        // container behind under the same name, and the next attempt cannot
        // reuse it.
        if (r.status !== 0) run("docker", ["rm", "-f", NAME]);
        return { status: r.status, stderr: r.stderr };
      },
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (port !== DEFAULT_PORT) console.log(`port ${DEFAULT_PORT} was taken, using ${port}`);
}

if (!waitReady()) {
  console.error("Postgres did not become ready");
  process.exit(1);
}

console.log(`ready on ${urlFor(port)}`);
