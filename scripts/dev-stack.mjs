/**
 * Local end-to-end stack: an empty Postgres and a Valkey in Docker for the server to use.
 *
 * Usage:
 *   node scripts/dev-stack.mjs up     start Postgres and Valkey
 *   node scripts/dev-stack.mjs down   stop and remove the containers
 *   node scripts/dev-stack.mjs env    print the env vars for the server
 *
 * It creates no tables. `server/store/schemaDdl.ts` is the single owner of that, and
 * it runs on every server start against whatever database it is pointed at.
 *
 * The containers are disposable and named distinctly so they can never be
 * confused with a real database.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { sleepSync } from "./lib/proc.mjs";
import { dockerDesktopPaths, dockerInfo, ensureEngine, pullImage } from "./dockerEngine.mjs";
import {
  hostPortOf,
  isPostgresReply,
  sslRequestPacket,
  startOnFreePort,
} from "./devStackPort.mjs";

const NAME = "murlan-dev-pg";
// Docker Hub's anonymous pull limit and ECR Public's anonymous data cap both reddened CI; Google's
// mirror of the Docker Official Images serves the same digest with neither. Every workflow's
// Postgres service repeats this (tests/tooling/postgresImage.test.ts).
const IMAGE = "mirror.gcr.io/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
const VALKEY_NAME = "murlan-dev-valkey";
// The Redis 7 container this stack ran before Valkey; left running it holds REDIS_BASE_PORT.
const RETIRED_NAMES = ["murlan-dev-redis"];
// The same mirror, for the same reasons; every workflow's Valkey service repeats this
// (tests/tooling/redisImage.test.ts).
const VALKEY_IMAGE = "mirror.gcr.io/valkey/valkey:9.1.3-alpine@sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b";
// What cacheName (dockerEngine.mjs) makes of the two above; tests/tooling/devStackImages.test.ts holds them equal.
const CACHED_IMAGE = "localhost/murlan-cache/721873c34ceb:postgres-16-alpine";
const CACHED_VALKEY_IMAGE = "localhost/murlan-cache/bf09d58e96d6:valkey-9.1.3-alpine";
const REDIS_BASE_PORT = 46379;
const redisUrlFor = (port) => `redis://127.0.0.1:${port}/0`;
// Below 49152: Windows carves its dynamic port reservations (Hyper-V, WSL) out of 49152-65535 only.
const DEFAULT_PORT = 45432;
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

/** The image `cached` (cacheName of `ref`), from the cache or pulled by `ref`'s pinned digest; every container runs the cached name. */
function ensureImage(ref, cached, pull) {
  pullImage({ present: () => docker(["image", "inspect", cached]).status === 0 || docker(["image", "inspect", ref]).status === 0, pull, sleep: sleepSync });
  if (docker(["image", "inspect", cached]).status !== 0) docker(["tag", ref, cached]);
}

function isRunning(name = NAME) {
  return docker(["ps", "-q", "-f", `name=^${name}$`]).stdout.trim().length > 0;
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
function publishedPort(name = NAME, containerPort = "5432") {
  if (!isRunning(name)) return null;
  const r = docker(["port", name, containerPort]);
  const port = r.status === 0 ? hostPortOf(r.stdout) : null;
  if (port === null) {
    throw new Error(`${name} is running but docker could not say where: ${r.stderr || r.stdout}`);
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
    sleepSync(1000);
  }
  return false;
}

/** Booted, and reachable at the address the rest of the repo will be handed. */
function reachableOn(port) {
  if (!containerReady()) return false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (postgresAnswers(port)) return true;
    sleepSync(500);
  }
  return false;
}

/** Redis, not merely something, answers `PING` on the host port. */
function redisAnswers(port, timeoutMs = 2000) {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const net=require('net');
       const c=net.connect(${port},'127.0.0.1');
       c.setTimeout(${timeoutMs});
       const bail=()=>{c.destroy();process.exit(1)};
       c.on('error',bail); c.on('timeout',bail); c.on('close',bail);
       c.on('connect',()=>c.write('PING\\r\\n'));
       c.on('data',(d)=>{process.exit(String(d).startsWith('+PONG')?0:1)});`,
    ],
    { encoding: "utf8" }
  );
  return r.status === 0;
}

function redisReachableOn(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (redisAnswers(port)) return true;
    sleepSync(500);
  }
  return false;
}

function startRedis() {
  for (const name of RETIRED_NAMES) docker(["rm", "-f", name]);
  const running = publishedPort(VALKEY_NAME, "6379");
  if (running !== null) {
    if (!redisReachableOn(running)) throw new Error(`${VALKEY_NAME} is running on ${running} but Redis does not answer there`);
    return running;
  }
  docker(["rm", "-f", VALKEY_NAME]);
  ensureImage(VALKEY_IMAGE, CACHED_VALKEY_IMAGE, () => docker(["pull", "-q", VALKEY_IMAGE]));
  return startOnFreePort({
    start: REDIS_BASE_PORT,
    canBind,
    discard: () => docker(["rm", "-f", VALKEY_NAME]),
    verify: redisReachableOn,
    run: (p) => {
      const r = docker(["run", "-d", "--name", VALKEY_NAME, "-p", `127.0.0.1:${p}:6379`, CACHED_VALKEY_IMAGE]);
      if (r.status !== 0) docker(["rm", "-f", VALKEY_NAME]);
      return { status: r.status, stderr: r.stderr };
    },
  });
}

const cmd = process.argv[2] ?? "up";

try {
  if (cmd === "env") {
    const port = publishedPort();
    if (port === null) {
      throw new Error(`${NAME} is not running — start it with \`node scripts/dev-stack.mjs up\``);
    }
    const redisPort = publishedPort(VALKEY_NAME, "6379");
    if (redisPort === null) {
      throw new Error(`${VALKEY_NAME} is not running — start it with \`node scripts/dev-stack.mjs up\``);
    }
    console.log(`DATABASE_URL=${urlFor(port)}`);
    console.log(`REDIS_URL=${redisUrlFor(redisPort)}`);
    console.log("SESSION_SECRET=local-dev-secret");
    process.exit(0);
  }

  if (cmd === "images") {
    console.log([IMAGE, VALKEY_IMAGE].join("\n"));
    process.exit(0);
  }

  if (cmd === "cached") {
    console.log([CACHED_IMAGE, CACHED_VALKEY_IMAGE].join("\n"));
    process.exit(0);
  }

  if (cmd === "down") {
    docker(["rm", "-f", NAME]);
    for (const name of [VALKEY_NAME, ...RETIRED_NAMES]) docker(["rm", "-f", name]);
    console.log("stopped");
    process.exit(0);
  }

  ensureEngine({
    engineUp: dockerInfo(run),
    exists: existsSync,
    launch: (p) => spawn(p, [], { detached: true, stdio: "ignore" }).unref(),
    sleep: sleepSync,
    paths: dockerDesktopPaths(),
  });

  if (cmd === "pull") {
    ensureImage(IMAGE, CACHED_IMAGE, () => docker(["pull", "-q", IMAGE]));
    ensureImage(VALKEY_IMAGE, CACHED_VALKEY_IMAGE, () => docker(["pull", "-q", VALKEY_IMAGE]));
    process.exit(0);
  }

  if (cmd === "held") {
    const missing = [CACHED_IMAGE, CACHED_VALKEY_IMAGE].filter((name) => docker(["image", "inspect", name]).status !== 0);
    if (missing.length) throw new Error(`not held: ${missing.join(", ")}`);
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
    ensureImage(IMAGE, CACHED_IMAGE, () => docker(["pull", "-q", IMAGE]));
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
          "-p", `127.0.0.1:${p}:5432`,
          CACHED_IMAGE,
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

  console.log(`ready on ${urlFor(port)} and ${redisUrlFor(startRedis())}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
