import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * `file` as origin/main's tip records it. Undefined only outside CI, where a clone may not hold
 * origin/main; in CI that throws, because a check skipped where it counts reports green by not
 * looking. ci.yml's test job fetches origin/main for it.
 */
export function atMain(file: string): unknown {
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    return JSON.parse(git(["show", `origin/main:${file}`]));
  } catch (e) {
    if (process.env.CI) throw new Error(`could not read ${file} at origin/main: ${(e as Error).message}`);
    return undefined;
  }
}

/** Every entry main records that `now` drops or rewrites: a version once recorded keeps its hash. */
export function rewritten(main: Record<string, string>, now: Record<string, string>): string[] {
  return Object.entries(main)
    .filter(([version, hash]) => now[version] !== hash)
    .map(([version, hash]) => `${version}: was ${hash}, now ${now[version] ?? "missing"}`);
}

/**
 * What the record should hold at `version`: main's history and this version's hash, and nothing
 * else — an entry only this branch wrote never shipped, so it is not history. A hash main already
 * records for `version` is never replaced: the shape changed under a shipped version, and only a
 * bump says so.
 */
export function withEntry(main: Record<string, string>, version: number, hash: string): { record: Record<string, string> } | { refused: string } {
  const at = String(version);
  if (main[at] !== undefined && main[at] !== hash) return { refused: `origin/main already records ${main[at]} for version ${at}` };
  return { record: { ...main, [at]: hash } };
}
