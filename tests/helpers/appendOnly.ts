import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * `file` as the merge base with origin/main recorded it, or undefined where that commit is not in
 * the clone: CI's test checkout is one commit deep.
 */
export function atMergeBase(file: string): unknown {
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    const base = git(["merge-base", "HEAD", "origin/main"]).trim();
    return JSON.parse(git(["show", `${base}:${file}`]));
  } catch {
    return undefined;
  }
}

/** Every recorded entry `now` drops or rewrites: a version once recorded keeps its hash. */
export function rewritten(base: Record<string, string>, now: Record<string, string>): string[] {
  return Object.entries(base)
    .filter(([version, hash]) => now[version] !== hash)
    .map(([version, hash]) => `${version}: was ${hash}, now ${now[version] ?? "missing"}`);
}
