import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const role = process.argv[2];
const triggerFile =
  process.env.MURLAN_DEV_SYNC_TRIGGER_FILE || "/tmp/murlan-dev-sync.trigger";
const restartGraceMs = 1_500;

const commands = {
  backend: ["server:dev"],
  frontend: ["expo:dev:clean"],
};

if (!commands[role]) {
  console.error("Usage: node scripts/dev-workflow-supervisor.mjs backend|frontend");
  process.exit(2);
}

let trigger = existsSync(triggerFile) ? readFileSync(triggerFile, "utf8") : "";
let child;
let stopping = false;
let restarting = false;

function startChild() {
  child = spawn("npm", ["run", ...commands[role]], {
    stdio: "inherit",
    env: process.env,
    // Keep npm, npx, and Expo in their own process group so stopping the
    // supervisor cannot leave a stale Metro descendant holding the port.
    detached: true,
  });
  child.once("exit", () => {
    child = undefined;
    if (stopping) return;
    setTimeout(startChild, 1_000);
  });
}

function stopChild() {
  if (!child) return;
  const pid = child.pid;
  if (!pid) return;

  // Killing npm alone orphaned the shell/npx/Expo descendants. Signal the
  // process group instead; the pid check prevents the delayed hard kill from
  // touching a replacement child that may have already started.
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  setTimeout(() => {
    if (child?.pid !== pid) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }, 5_000);
}

function restartAfterSync() {
  if (restarting) return;
  restarting = true;
  setTimeout(() => {
    restarting = false;
    stopChild();
  }, restartGraceMs);
}

const watcher = setInterval(() => {
  const next = existsSync(triggerFile) ? readFileSync(triggerFile, "utf8") : "";
  if (next && next !== trigger) {
    trigger = next;
    restartAfterSync();
  }
}, 250);

function shutdown() {
  stopping = true;
  clearInterval(watcher);
  stopChild();
  setTimeout(() => process.exit(0), 5_500);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
startChild();