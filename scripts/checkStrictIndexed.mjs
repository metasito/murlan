#!/usr/bin/env node
/**
 * Runs tsc against the noUncheckedIndexedAccess ratchet config and fails on
 * any error inside the areas its `include` list names.
 *
 * The flag applies to the whole program tsc builds, which includes files
 * outside those areas that get pulled in by import (lib/, components/, …).
 * Those are separate tickets' debt, not this ratchet's, so only diagnostics
 * whose path falls under a listed area count. An include list that names no
 * real files would pass vacuously, so that is checked and failed on directly
 * — a ratchet that always passes finds nothing.
 *
 * Run with: node scripts/checkStrictIndexed.mjs [path/to/tsconfig.json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_CONFIG = path.join(REPO_ROOT, "tsconfig.strictIndexed.json");

// The `tsc` shim (.cmd on Windows) needs a shell to launch and fails with
// EINVAL under Node's execFileSync without one; running its JS entry point
// through this process's own `node` sidesteps that on every platform.
const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");

/** The top-level directory each include glob is rooted at, deduped. */
export function areasOf(config) {
  return [...new Set((config.include ?? []).map((pattern) => pattern.split("/")[0]))];
}

function hasSourceFiles(repoRoot, area) {
  let entries;
  try {
    entries = readdirSync(path.join(repoRoot, area), { withFileTypes: true, recursive: true });
  } catch {
    return false;
  }
  return entries.some((e) => e.isFile() && /\.tsx?$/.test(e.name));
}

/**
 * Runs the ratchet config at `configPath` and reports whether the areas it
 * names are clean. Never throws on a type error — that is the expected,
 * reportable outcome; it throws only when tsc itself could not be run.
 */
export function runStrictIndexedCheck(configPath = DEFAULT_CONFIG, repoRoot = REPO_ROOT) {
  const label = path.relative(repoRoot, configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const areas = areasOf(config);

  if (areas.length === 0) {
    return { ok: false, message: `${label}: include list is empty — nothing would be checked.` };
  }

  const emptyAreas = areas.filter((area) => !hasSourceFiles(repoRoot, area));
  if (emptyAreas.length > 0) {
    return {
      ok: false,
      message: `${label}: include area(s) matched no files: ${emptyAreas.join(", ")}`,
    };
  }

  let output = "";
  try {
    execFileSync(process.execPath, [tscBin, "--noEmit", "-p", configPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch (err) {
    // A numeric exit status means tsc ran and found errors — read them off
    // its output. Anything else (ENOENT, EINVAL, a signal) means tsc never
    // ran at all, and reading empty output as "no errors" would pass the
    // ratchet without checking anything — the exact self-defeating shape
    // this exists to rule out.
    if (typeof err.status !== "number") {
      throw new Error(`Failed to run tsc: ${err.message}`);
    }
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const scoped = output
    .split("\n")
    .filter((line) => areas.some((area) => line.startsWith(`${area}/`) || line.startsWith(`${area}\\`)));

  if (scoped.length > 0) {
    return {
      ok: false,
      message:
        `${scoped.join("\n")}\n\n${scoped.length} noUncheckedIndexedAccess error(s) ` +
        `in ratcheted area(s): ${areas.join(", ")}.`,
    };
  }

  return { ok: true, message: `noUncheckedIndexedAccess clean: ${areas.join(", ")}` };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const configPath = process.argv[2] ? path.resolve(REPO_ROOT, process.argv[2]) : DEFAULT_CONFIG;
  const { ok, message } = runStrictIndexedCheck(configPath);
  if (ok) console.log(message);
  else console.error(message);
  if (!ok) process.exit(1);
}
