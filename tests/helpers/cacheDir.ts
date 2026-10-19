import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { trackedRootFiles } from "./trackedFiles.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The checkout holding the install every worktree shares (docs/agents/RULES.md rule 10). */
export function sharedCheckout(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return path.dirname(common);
}

/** Inside the install Node resolves packages from, or the temp dir: a cache never creates a `node_modules` of its own. */
export function cacheBase(): string {
  const install = path.resolve(createRequire(import.meta.url).resolve("typescript/package.json"), "..", "..");
  if (existsSync(path.join(install, ".package-lock.json"))) return path.join(install, ".cache");
  return path.join(tmpdir(), "murlan-cache");
}

/**
 * What any cached lint or compile result depends on beyond the file it is for: every installed
 * version and patch, the configs that load them, and the test whose options and result mapping
 * produced it.
 */
function keyInputs(root: string): string[] {
  const configs = trackedRootFiles(root).filter((name) => /^eslint\./.test(name));
  return ["package-lock.json", "patches", "babel.config.js", ...configs];
}

function filesUnder(file: string): string[] {
  if (!existsSync(file)) return [];
  if (!statSync(file).isDirectory()) return [file];
  return readdirSync(file)
    .sort()
    .flatMap((name) => filesUnder(path.join(file, name)));
}

function cacheKey(root: string, extraFiles: string[]): string {
  const hash = createHash("sha256").update(process.version);
  for (const input of [...keyInputs(root), ...extraFiles]) {
    const absolute = path.resolve(root, input);
    hash.update(`\0${path.relative(root, absolute)}\0`);
    for (const file of filesUnder(absolute)) {
      hash.update(`\0${path.relative(root, file)}\0`).update(readFileSync(file));
    }
  }
  return hash.digest("hex").slice(0, 24);
}

/**
 * The directory for cache `name` under today's key inputs plus `extraFiles`, created, with every
 * other key's directory for the same name removed.
 */
export function cacheFor(
  name: string,
  extraFiles: string[],
  { root = repoRoot, base = cacheBase() }: { root?: string; base?: string } = {}
): string {
  const parent = path.join(base, name);
  const key = cacheKey(root, extraFiles);
  mkdirSync(path.join(parent, key), { recursive: true });
  for (const sibling of readdirSync(parent)) {
    if (sibling !== key) rmSync(path.join(parent, sibling), { recursive: true, force: true });
  }
  return path.join(parent, key);
}
