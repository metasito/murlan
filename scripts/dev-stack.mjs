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
import {
  hostPortOf,
  isPostgresReply,
  sslRequestPacket,
  startOnFreePort,
} from "./devStackPort.mjs";

const NAME = "murlan-dev-pg";
const DEFAULT_PORT = 55432;
const requested = process.env.MURLAN_DEV_PG_PORT;
const BASE_PORT = Number(requested ?? DEFAULT_PORT);
const urlFor = (port) => `postgres://postgres:postgres@127.0.0.1:${port}/murlan_dev`;

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

/**
 * `docker`, with a missing binary reported as itself. `spawnSync` leaves
 * `stdout` undefined when the command does not exist, so every caller reading
 * it would otherwise die on a TypeError naming nothing useful.
 */
function docker(args) {
  const r = run("docker", args);
  if (r.error) {
    throw new Error(`could not run docker (${r.error.code ?? r.error.message}) — is it installed?`);
  }
  return r;
}

function isRunning() {
  return docker(["ps", "-q", "-f", `name=^${NAME}$`]).stdout.trim().length > 0;
}

/**
 * Where the container is, asked of Docker rather than assumed from the
 * environment. `up` may have settled on a port other than the base one, and
 * `env` runs as its own process with no memory of that; the daemon is the only
 * party that cannot be out of date about its own container.
 *
 * "Not running" and "running but unreadable" are kept apart: the first is
 * ordinary and the second must never reach the branch that force-removes the
 * container, which would destroy a database another suite is connected to over
 * a transient daemon hiccup.
 */
function publishedPort() {
  if (!isRunning()) return null;
  const r = docker(["port", NAME, "5432"]);
  const port = r.status === 0 ? hostPortOf(r.stdout) : null;
  if (port === null) {
    throw new Error(`${NAME} is running but docker could not say where: ${r.stderr || r.stdout}`);
  }
  return port;
}

/**
 * Whether the port is free — the holder Docker will not see.
 *
 * Binding is the only way to ask, and it has to happen in a process that then
 * exits, so the port is released before `docker run` wants it. That leaves a
 * gap between the answer and the claim; the two checks after this one are what
 * close it.
 */
function canBind(port) {
  const r = spawnSync(process.execPath, [
    "-e",
    `const net=require('net');const s=net.createServer();` +
      `s.once('error',()=>process.exit(1));` +
      `s.listen(${port},'0.0.0.0',()=>s.close(()=>process.exit(0)));`,
  ]);
  return r.status === 0;
}

const sleep = (ms) => execFileSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);

/**
 * Whether Postgres — not merely something — answers on the host port.
 *
 * The whole point of the check is that a squatter also accepts a connection,
 * so acceptance proves nothing. Postgres replies to an SSLRequest with a
 * single byte; nothing else does.
 */
function postgresAnswers(port, timeoutMs = 2000) {
  const ask = JSON.stringify([...sslRequestPacket()]);
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const net=require('net');
       const c=net.connect(${port},'127.0.0.1');
       c.setTimeout(${timeoutMs});
       const bail=()=>{c.destroy();process.exit(1)};
       c.on('error',bail); c.on('timeout',bail); c.on('close',bail);
       c.on('connect',()=>c.write(Buffer.from(${ask})));
       c.on('data',(d)=>{process.stdout.write(d.toString('hex'));c.destroy();process.exit(0)});`,
    ],
    { encoding: "utf8" }
  );
  return r.status === 0 && isPostgresReply(Buffer.from(r.stdout.trim(), "hex"));
}

/** Postgres inside the container has finished booting. */
function containerReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (docker(["exec", NAME, "pg_isready", "-U", "postgres"]).status === 0) return true;
    sleep(1000);
  }
  return false;
}

/** Booted, and reachable at the address the rest of the repo will be handed. */
function reachableOn(port) {
  if (!containerReady()) return false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (postgresAnswers(port)) return true;
    sleep(500);
  }
  return false;
}

const cmd = process.argv[2] ?? "up";

try {
  if (cmd === "env") {
    const port = publishedPort();
    if (port === null) {
      throw new Error(`${NAME} is not running — start it with \`node scripts/dev-stack.mjs up\``);
    }
    console.log(`DATABASE_URL=${urlFor(port)}`);
    console.log("SESSION_SECRET=local-dev-secret");
    process.exit(0);
  }

  if (cmd === "down") {
    docker(["rm", "-f", NAME]);
    console.log("stopped");
    process.exit(0);
  }

  let port = publishedPort();
  if (port !== null && requested !== undefined && port !== BASE_PORT) {
    throw new Error(
      `MURLAN_DEV_PG_PORT asked for ${BASE_PORT}, but ${NAME} is already running on ${port}. ` +
        `Run \`node scripts/dev-stack.mjs down\` first.`
    );
  }

  if (port === null) {
    docker(["rm", "-f", NAME]);
    port = startOnFreePort({
      start: BASE_PORT,
      explicit: requested !== undefined,
      canBind,
      discard: () => docker(["rm", "-f", NAME]),
      verify: reachableOn,
      run: (p) => {
        const r = docker([
          "run", "-d", "--name", NAME,
          "-e", "POSTGRES_USER=postgres",
          "-e", "POSTGRES_PASSWORD=postgres",
          "-e", "POSTGRES_DB=murlan_dev",
          "-p", `${p}:5432`,
          "postgres:16-alpine",
        ]);
        // A run that got far enough to claim the name and then failed leaves
        // the container behind, and the next attempt cannot reuse it.
        if (r.status !== 0) docker(["rm", "-f", NAME]);
        return { status: r.status, stderr: r.stderr };
      },
    });
    if (requested === undefined && port !== DEFAULT_PORT) {
      console.log(`port ${DEFAULT_PORT} was not usable, using ${port}`);
    }
  } else if (!reachableOn(port)) {
    throw new Error(`${NAME} is running on ${port} but Postgres does not answer there`);
  }

  console.log(`ready on ${urlFor(port)}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
