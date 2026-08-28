// Reproduction for #544: two server processes, one database, one room.
//
// Not a test — a one-shot demonstration kept so the finding can be re-checked
// rather than taken on trust. Production deploys to Cloud Run
// (`.replit` -> deploymentTarget = "cloudrun") with no instance cap, so "two
// processes" is the deployed shape, not a hypothetical.
//
//   DATABASE_URL=postgres://... node scripts/repro-544.mjs
import { spawn } from "node:child_process";
import pg from "pg";
import { io as connect } from "socket.io-client";

const BASE = process.env.DATABASE_URL;
if (!BASE) {
  console.error("DATABASE_URL is required — `node scripts/dev-stack.mjs up` prints one.");
  process.exit(2);
}

const schema = `repro544_${Date.now()}`;
const scoped = `${BASE}${BASE.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;

const admin = new pg.Pool({ connectionString: BASE });
await admin.query(`CREATE SCHEMA "${schema}"`);

const children = [];
function boot(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "server/index.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: scoped,
          PORT: String(port),
          SESSION_SECRET: "repro-544-secret",
          LOG_LEVEL: "silent",
          NODE_ENV: "development",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    children.push(child);
    const done = setTimeout(() => reject(new Error(`instance on ${port} never came up`)), 30_000);
    const watch = (buf) => {
      if (String(buf).includes(String(port)) || String(buf).includes("listening")) {
        clearTimeout(done);
        setTimeout(() => resolve(child), 400);
      }
    };
    child.stdout.on("data", watch);
    child.stderr.on("data", watch);
  });
}

async function register(port, username) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "repro-544-pw" }),
  });
  if (!res.ok) throw new Error(`register ${username}: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return cookie;
}

function socketFor(port, cookie) {
  return new Promise((resolve, reject) => {
    const s = connect(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
    setTimeout(() => reject(new Error("socket never connected")), 10_000);
  });
}

const waitFor = (socket, event, ms = 4000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });

let exitCode = 0;
try {
  console.log(`schema ${schema}`);
  await boot(5551);
  await boot(5552);
  console.log("two instances up on 5551 and 5552, sharing one database\n");

  const tag = Date.now().toString(36);
  const aCookie = await register(5551, `r544a${tag}`);
  const bCookie = await register(5552, `r544b${tag}`);

  const a = await socketFor(5551, aCookie);
  const b = await socketFor(5552, bCookie);

  // A opens a room on instance 1.
  const made = waitFor(a, "room:state");
  a.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
  const room = await made;
  if (!room) throw new Error("instance 1 never answered room:create");
  console.log(`A created room ${room.code} on instance 1`);

  // B joins the same room by code — on instance 2. The row is shared, so the
  // seat claim succeeds. What is asked here is whether A ever hears about it.
  const aHears = waitFor(a, "room:state");
  const bHears = waitFor(b, "room:state");
  b.emit("room:join", { code: room.code });

  const bState = await bHears;
  const aState = await aHears;

  console.log(`\nB joined:                       ${bState ? "yes" : "NO"}`);
  console.log(`B sees ${bState ? bState.players.length : "?"} player(s) in the room`);
  console.log(`A was told B arrived:           ${aState ? "yes" : "NO  <- the defect"}`);

  if (!aState) {
    console.log(
      "\nA and B are in the same room row and cannot see each other.\n" +
      "io.to(roomId) reached only instance 2's sockets. Every seat, every\n" +
      "start and every play broadcast has the same hole."
    );
    exitCode = 1;
  } else {
    console.log("\nBoth sides saw the join — the split did not reproduce here.");
  }

  a.close();
  b.close();
} catch (err) {
  console.error("repro failed to run:", err.message);
  exitCode = 2;
} finally {
  for (const c of children) c.kill("SIGKILL");
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
process.exit(exitCode);
