#!/usr/bin/env node
// Fails when the web bundle's gzipped JS crosses the committed budget.
//
// #95 chose a whole visual direction on the promise that the web bundle stays
// under ~1 MB gzipped, and nothing enforced it — the next dependency to add
// 400 KB would have landed silently and been found by a player on mobile data.
//
// Gzip rather than raw bytes: raw is not what anyone downloads, and the two
// diverge by more than a factor of three. Plain Node, no dependencies, so
// whatever runs the build still needs nothing installed.
//
// Run with: node scripts/bundle-budget.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/entry.mjs";

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

/** What loads after the first paint measured 158 KB with Skia's felt in it (#1257). */
export const DEFERRED_BUDGET_BYTES = 250_000;

export const DIST_DIR = path.join(ROOT, "dist");
export const BUNDLE_DIR = path.join(DIST_DIR, "_expo", "static", "js", "web");

/** A string of `canvaskit-wasm`'s loader that minification keeps: the file it fetches. */
export const CANVASKIT_MARK = "canvaskit.wasm";

/**
 * Gzipped size of every .js file in `dir`, or of those `only` accepts.
 *
 * Throws on a directory with no JS in it. A size gate that silently measures
 * nothing is a gate that always passes — the one failure mode that makes the
 * whole check worthless.
 */
export function gzippedJsSize(dir, only = () => true) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    throw new Error(`No web bundle at ${dir} — run \`npm run expo:web:build\` first.`);
  }
  const files = entries.filter((f) => f.endsWith(".js") && only(f));
  if (files.length === 0) {
    throw new Error(`No .js files in ${dir} — nothing to measure, so nothing was checked.`);
  }
  let total = 0;
  for (const file of files) {
    total += zlib.gzipSync(fs.readFileSync(path.join(dir, file))).length;
  }
  return { total, files: files.length };
}

/** The bundle files `index.html` loads itself — everything else is fetched on demand. */
export function firstLoadFiles(distDir) {
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  const files = [...html.matchAll(/<script[^>]+src="[^"]*\/([^/"]+\.js)"/g)].map((m) => m[1]);
  if (files.length === 0) throw new Error(`index.html loads no script — nothing was checked.`);
  return new Set(files);
}

/** Which JS files carry CanvasKit's loader; the first load must have none, and some file must. */
export function canvasKitCheck(dir, firstLoad) {
  const carrying = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && fs.readFileSync(path.join(dir, f), "utf8").includes(CANVASKIT_MARK));
  if (carrying.length === 0) {
    return { ok: false, message: `No bundle file carries ${CANVASKIT_MARK}: the CanvasKit check found nothing to hold out.` };
  }
  const early = carrying.filter((f) => firstLoad.has(f));
  return early.length
    ? { ok: false, message: `CanvasKit is in the web first load (docs/BUNDLE.md): ${early.join(", ")}` }
    : { ok: true, message: `CanvasKit loads on demand, in ${carrying.join(", ")}.` };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/** The verdict and the numbers behind it — enough to act on without re-running. */
export function report(total, files, budget = BUDGET_BYTES, label = "Web bundle") {
  const delta = total - budget;
  if (delta > 0) {
    return {
      over: true,
      message:
        `${label} is over budget.\n` +
        `  measured: ${kb(total)} gzipped, across ${files} JS file(s)\n` +
        `  budget:   ${kb(budget)}\n` +
        `  over by:  ${kb(delta)}\n\n` +
        `Reduce the bundle, or raise the budget in scripts/bundle-budget.mjs\n` +
        `with a reason — it is committed so that raising it is reviewable.`,
    };
  }
  return {
    over: false,
    message:
      `${label} is within budget.\n` +
      `  measured: ${kb(total)} gzipped, across ${files} JS file(s)\n` +
      `  budget:   ${kb(budget)}\n` +
      `  headroom: ${kb(-delta)}`,
  };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const first = firstLoadFiles(DIST_DIR);
  const initial = gzippedJsSize(BUNDLE_DIR, (f) => first.has(f));
  if (initial.files !== first.size) throw new Error(`index.html loads ${first.size} scripts, ${initial.files} are in the bundle.`);
  const verdicts = [report(initial.total, initial.files, BUDGET_BYTES, "The web first load")];
  const deferred = gzippedJsSize(BUNDLE_DIR, (f) => !first.has(f));
  verdicts.push(report(deferred.total, deferred.files, DEFERRED_BUDGET_BYTES, "Deferred web JS"));
  const canvasKit = canvasKitCheck(BUNDLE_DIR, first);
  for (const v of verdicts) console.log(v.message);
  console.log(canvasKit.message);
  if (verdicts.some((v) => v.over) || !canvasKit.ok) process.exit(1);
}
