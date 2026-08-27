/**
 * Refuses to start a run while the shared checkout has uncommitted work.
 *
 * Sessions share that checkout. An edit left sitting in it belongs to nobody a later session can
 * identify: it cannot tell whose it is, whether it is mid-flight, or whether discarding it loses
 * work — so the safe move is to investigate, and investigating costs more than the edit did.
 * Naming the files at the start of a run is the whole fix.
 *
 * Untracked files are listed but do not block: a scratch directory is not someone's in-flight
 * change, and blocking on one would make the check something to skip.
 *
 * Usage: node scripts/preflight.mjs
 */
import { execFileSync } from "node:child_process";

export function classifyStatus(porcelain) {
  const blocking = [];
  const untracked = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (code === "??") untracked.push(file);
    else blocking.push(`${code.trim()} ${file}`);
  }
  return { blocking, untracked };
}

/** The primary worktree — `git worktree list` always prints it first. */
export function primaryWorktree(porcelainList) {
  const first = porcelainList.split("\n").find((l) => l.startsWith("worktree "));
  return first ? first.slice("worktree ".length).trim() : null;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const shared = primaryWorktree(git(["worktree", "list", "--porcelain"]));
  if (!shared) {
    console.error("preflight: could not find the primary worktree");
    process.exit(1);
  }
  const { blocking, untracked } = classifyStatus(git(["status", "--porcelain"], shared));

  if (untracked.length) {
    console.log(`preflight: ${untracked.length} untracked path(s) in ${shared}, not blocking:`);
    for (const f of untracked) console.log(`  ? ${f}`);
  }

  if (blocking.length) {
    console.error(`\npreflight: ${shared} has uncommitted changes. A run must not start on top of them.\n`);
    for (const f of blocking) console.error(`  ${f}`);
    console.error(
      "\nThey belong to a session that did not finish. Commit them on a branch, or ask their owner " +
        "to. Do not stash or discard them — that removes the work with nothing pointing at where it went."
    );
    process.exit(1);
  }
  console.log(`preflight: ${shared} is clean.`);
}
