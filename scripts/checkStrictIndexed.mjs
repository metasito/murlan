#!/usr/bin/env node
/**
 * Runs tsc against the noUncheckedIndexedAccess ratchet config and fails on
 * any error inside the areas its `include` list names.
 *
 * The flag applies to the whole program tsc builds, which includes files
 * outside those areas that get pulled in by import (lib/, components/, …).
 * Those are separate tickets' debt, not this ratchet's, so only diagnostics
 * whose path falls under a listed area count.
 *
 * That filter is also what makes a vacuous pass possible: a config that
 * compiles nothing, or one tsc rejects outright, emits no path-prefixed
 * diagnostic and would read as clean. So the floor is what tsc itself says it
 * would compile — the root file list per area — rather than what happens to
 * sit on disk under that directory, and a diagnostic naming no file fails the
 * run instead of being filtered away as another area's debt.
 *
 * Run with: node scripts/checkStrictIndexed.mjs [path/to/tsconfig.json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_CONFIG = path.join(REPO_ROOT, "tsconfig.strictIndexed.json");

// The `tsc` shim (.cmd on Windows) needs a shell to launch and fails with
// EINVAL under Node's execFileSync without one; running its JS entry point
// through this process's own `node` sidesteps that on every platform.
const requireFromHere = createRequire(import.meta.url);
const tscBin = requireFromHere.resolve("typescript/bin/tsc");
const ts = requireFromHere("typescript");

/** The top-level directory each include glob is rooted at, deduped. */
export function areasOf(config) {
  return [...new Set((config.include ?? []).map((pattern) => pattern.split("/")[0]))];
}

/**
 * What tsc resolves `configPath` to: the root files it would compile, and any
 * complaint about the config itself. TS18003 ("no inputs were found") is left
 * out — an empty root list says the same thing in the area's own terms.
 */
function resolveConfig(configPath, repoRoot) {
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) {
    return { errors: [ts.flattenDiagnosticMessageText(error.messageText, " ")], rootFiles: [] };
  }
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath
  );
  return {
    errors: parsed.errors
      .filter((d) => d.code !== 18003)
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`),
    rootFiles: parsed.fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join("/")),
  };
}

/**
 * Runs the ratchet config at `configPath` and reports whether the areas it
 * names are clean. Never throws on a type error — that is the expected,
 * reportable outcome; it throws only when tsc itself could not be run.
 */
export function runStrictIndexedCheck(configPath = DEFAULT_CONFIG, repoRoot = REPO_ROOT) {
  const label = path.relative(repoRoot, configPath);
  const areas = areasOf(JSON.parse(readFileSync(configPath, "utf8")));

  if (areas.length === 0) {
    return { ok: false, message: `${label}: include list is empty — nothing would be checked.` };
  }

  const { errors, rootFiles } = resolveConfig(configPath, repoRoot);
  if (errors.length > 0) {
    return { ok: false, message: `${label}: tsc rejected the config:\n${errors.join("\n")}` };
  }

  const emptyAreas = areas.filter((area) => !rootFiles.some((f) => f.startsWith(`${area}/`)));
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

  const lines = output.split("\n").map((line) => line.replace(/\r$/, ""));

  // A diagnostic that names no file is about the run itself, not about one
  // area's debt, so it must never be filtered out as another ticket's problem.
  const unscoped = lines.filter((line) => /^error TS\d+:/.test(line));
  if (unscoped.length > 0) {
    return { ok: false, message: `${label}: tsc could not check the areas:\n${unscoped.join("\n")}` };
  }

  const scoped = lines.filter((line) =>
    areas.some((area) => line.startsWith(`${area}/`) || line.startsWith(`${area}\\`))
  );

  if (scoped.length > 0) {
    return {
      ok: false,
      message:
        `${scoped.join("\n")}\n\n${scoped.length} error(s) under noUncheckedIndexedAccess ` +
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
