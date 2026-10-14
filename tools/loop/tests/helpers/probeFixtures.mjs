// The probe branches loopGate.test.ts makes in the shared checkout, and the sweep that clears them.
// Each name carries the pid of the run that made it, so two runs on one clone never share one and
// a run sweeps only its own fixtures and those of a run whose process is gone.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { worktrees } from "../../loop-derive.mjs";

const PRUNE = fileURLToPath(new URL("../../workspace.mjs", import.meta.url));

// `97`, not `99`: a suite from before pids were in the name sweeps every `agent/99*`.
const OWNED = /^(?:agent\/97(\d{10})\d{2}-|loop-gate-probe\/(\d+)\/)/;

export function probeTicket(k, pid = process.pid) {
  return Number(`97${String(pid).padStart(10, "0")}${String(k).padStart(2, "0")}`);
}

export function probeBranch(k, slug, pid = process.pid) {
  return `agent/${probeTicket(k, pid)}-${slug}`;
}

export function offTicketBranch(slug, pid = process.pid) {
  return `loop-gate-probe/${pid}/${slug}`;
}

export function ownerOf(branch) {
  const m = OWNED.exec(branch);
  return m ? Number(m[1] ?? m[2]) : null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** A reused pid keeps a dead run's leftovers until that process exits too: kept, never deleted. */
function sweepable(branch) {
  const pid = ownerOf(branch);
  return pid !== null && (pid === process.pid || !alive(pid));
}

/** RULES.md rule 39: never `git worktree remove`, which follows a node_modules junction. */
export function removeWorktree(root, wt) {
  try {
    execFileSync(process.execPath, [PRUNE, "remove", wt, "--force"], { cwd: root, stdio: "ignore" });
  } catch {
    /* already detached; the prune finishes it */
  }
  rmSync(wt, { recursive: true, force: true });
}

export function sweep(root) {
  for (const { dir, branch } of worktrees(root)) {
    if (dir && branch && sweepable(branch)) removeWorktree(root, dir);
  }
  execFileSync("git", ["worktree", "prune"], { cwd: root });
  const branches = execFileSync(
    "git",
    ["branch", "--list", "agent/97*", "loop-gate-probe/*", "--format=%(refname:short)"],
    { cwd: root, encoding: "utf8" }
  )
    .split(/\r?\n/)
    .filter(Boolean);
  for (const b of branches) {
    if (!sweepable(b)) continue;
    try {
      execFileSync("git", ["branch", "-qD", b], { cwd: root, stdio: "ignore" });
    } catch {
      /* still checked out in a worktree */
    }
  }
}
