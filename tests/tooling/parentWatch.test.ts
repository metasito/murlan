import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const watchModule = pathToFileURL(path.resolve(import.meta.dirname, "..", "..", "scripts", "lib", "parentWatch.mjs")).href;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end && !check(); ) await new Promise((r) => setTimeout(r, 50));
  return check();
}

/** A runner that starts a wrapper that starts a server, as Playwright does `scripts/e2e-server.mjs`; the runner is then SIGKILLed. */
async function killRunner(dir: string, watch: boolean) {
  const wrapper = path.join(dir, `wrapper-${watch}.mjs`);
  writeFileSync(
    wrapper,
    [
      'import { spawn } from "node:child_process";',
      `import { exitWithParent } from ${JSON.stringify(watchModule)};`,
      'const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      watch ? "exitWithParent(() => { server.kill('SIGKILL'); process.exit(1); }, { everyMs: 100 });" : "",
      'console.log(`pids ${process.pid} ${server.pid}`);',
      "setInterval(() => {}, 1000);",
    ].join("\n")
  );
  const runner = path.join(dir, `runner-${watch}.mjs`);
  writeFileSync(
    runner,
    `import { spawn } from "node:child_process";\nspawn(process.execPath, [${JSON.stringify(wrapper)}], { stdio: "inherit" });\nsetInterval(() => {}, 1000);\n`
  );
  const child = spawn(process.execPath, [runner], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  assert.ok(await until(() => /pids \d+ \d+/.test(out), 10_000), "the wrapper never started");
  const [, w, s] = out.match(/pids (\d+) (\d+)/)!.map(Number) as [number, number, number];
  child.kill("SIGKILL");
  const gone = await until(() => !alive(w) && !alive(s), 5_000);
  for (const pid of [w, s]) if (alive(pid)) process.kill(pid, "SIGKILL");
  return gone;
}

test("a wrapper and its server end when the runner that started them is SIGKILLed", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "parent-watch-"));
  try {
    assert.equal(await killRunner(dir, true), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without the watch both leak, so the test above can see the defect", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "parent-watch-"));
  try {
    assert.equal(await killRunner(dir, false), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
