#!/usr/bin/env node
// Fails when the web bundle's gzipped JS crosses the committed budget.
//
// #95 chose a whole visual direction on the promise that the web bundle stays
// under ~1 MB gzipped, and nothing enforced it — the next dependency to add
// 400 KB would have landed silently and been found by a player on mobile data.
//
// Gzip rather than raw bytes: raw is not what anyone downloads, and the two
// diverge by more than a factor of three. Plain Node, no dependencies, so the
// Replit Run button still needs nothing installed.
//
// Run with: node scripts/bundle-budget.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * The ceiling from #95, in bytes of gzipped JS. Deliberately above today's
 * measured size rather than at it: a budget that fails on the first honest
 * commit gets raised reflexively and then means nothing.
 *
 * One committed number on purpose — raising it is a reviewable diff that shows
 * up in `git log`, not an environment variable someone can set in passing.
 */
export const BUDGET_BYTES = 1_000_000;

export const BUNDLE_DIR = path.join(ROOT, "dist", "_expo", "static", "js", "web");

/**
 * Gzipped size of every .js file in `dir`.
 *
 * Throws on a directory with no JS in it. A size gate that silently measures
 * nothing is a gate that always passes — the one failure mode that makes the
 * whole check worthless.
 */
export function gzippedJsSize(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    throw new Error(`No web bundle at ${dir} — run \`npm run expo:web:build\` first.`);
  }
  const files = entries.filter((f) => f.endsWith(".js"));
  if (files.length === 0) {
    throw new Error(`No .js files in ${dir} — nothing to measure, so nothing was checked.`);
  }
  let total = 0;
  for (const file of files) {
    total += zlib.gzipSync(fs.readFileSync(path.join(dir, file))).length;
  }
  return { total, files: files.length };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/** The verdict and the numbers behind it — enough to act on without re-running. */
export function report(total, files, budget = BUDGET_BYTES) {
  const delta = total - budget;
  if (delta > 0) {
    return {
      over: true,
      message:
        `Web bundle is over budget.\n` +
        `  measured: ${kb(total)} gzipped, across ${files} JS file(s)\n` +
        `  budget:   ${kb(budget)}\n` +
        `  over by:  ${kb(delta)}\n\n` +
        `Reduce the bundle, or raise BUDGET_BYTES in scripts/bundle-budget.mjs\n` +
        `with a reason — it is committed so that raising it is reviewable.`,
    };
  }
  return {
    over: false,
    message:
      `Web bundle is within budget.\n` +
      `  measured: ${kb(total)} gzipped, across ${files} JS file(s)\n` +
      `  budget:   ${kb(budget)}\n` +
      `  headroom: ${kb(-delta)}`,
  };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { total, files } = gzippedJsSize(BUNDLE_DIR);
  const { over, message } = report(total, files);
  console.log(message);
  if (over) process.exit(1);
}
