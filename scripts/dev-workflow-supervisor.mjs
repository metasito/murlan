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
  });
  child.once("exit", () => {
    child = undefined;
    if (stopping) return;
    setTimeout(startChild, 1_000);
  });
}

function stopChild() {
  if (!child) return;
  child.kill("SIGTERM");
  setTimeout(() => child?.kill("SIGKILL"), 5_000);
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