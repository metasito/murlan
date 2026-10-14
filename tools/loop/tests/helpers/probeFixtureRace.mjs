// One side of loopGate.test.ts's two-runs-on-one-clone case: both make fixtures at once, and fail
// if either the making or the peer's sweep cost a side a fixture.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { probeBranch, removeWorktree, sweep } from "./probeFixtures.mjs";

const [root, dir, me, peer] = process.argv.slice(2);
const pause = new Int32Array(new SharedArrayBuffer(4));
const mark = (step) => writeFileSync(join(dir, `${me}.${step}`), "");
function until(step) {
  const deadline = Date.now() + 20_000;
  while (!existsSync(join(dir, `${peer}.${step}`))) {
    if (existsSync(join(dir, `${peer}.failed`))) throw new Error(`${peer} failed before ${step}`);
    if (Date.now() > deadline) throw new Error(`${peer} never reached ${step}`);
    Atomics.wait(pause, 0, 0, 50);
  }
}
const exists = (branch) =>
  execFileSync("git", ["branch", "--list", branch], { cwd: root, encoding: "utf8" }).trim() !== "";

const wt = join(dir, me);
try {
  sweep(root);
  mark("started");
  until("started");
  const checkedOut = probeBranch(1, "empty");
  execFileSync("git", ["worktree", "add", "-q", "-b", checkedOut, wt, "HEAD"], { cwd: root, stdio: "pipe" });
  // The window between `branch` and `worktree add`, held open: nothing protects it but the sweep.
  const idle = probeBranch(2, "idle");
  execFileSync("git", ["branch", idle, "HEAD"], { cwd: root });
  mark("made");
  until("made");
  // One side sweeps, as a run starting or finishing does, while the other's fixtures are live.
  if (me < peer) {
    sweep(root);
    mark("swept");
    until("checked");
  } else {
    until("swept");
    for (const b of [checkedOut, idle]) if (!exists(b)) throw new Error(`the peer's sweep deleted ${b}`);
    mark("checked");
  }
} catch (e) {
  mark("failed");
  console.error(`${me}: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  removeWorktree(root, wt);
  sweep(root);
}
