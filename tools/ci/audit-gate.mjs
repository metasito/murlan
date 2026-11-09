/**
 * ci.yml's `Audit`: red on a critical or high advisory in production dependencies whose fix is not a
 * major bump. A major is the owner's call and does not fail it. Output that is not an audit report is red.
 * With `--base <ref>` (a pull request) only a package whose lockfile entry differs from that ref's can fail
 * it, so an advisory published today does not red a PR that did not touch the package; main and the
 * schedule run it unscoped.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { runBin } from "../../scripts/lib/proc.mjs";

/**
 * A package flagged only because of another package (`via` names it) is fixable only when that package is:
 * npm reports `fixAvailable: true` for the dependent while the advisory's own package has no non-major fix.
 * @param {{ vulnerabilities?: Record<string, { severity: string, fixAvailable: unknown, via?: unknown[] }> } | null} report
 * @param {Set<string> | null} [only] the names that may fail it; every name when null
 */
export function fixableSevere(report, only = null) {
  if (!report || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) return null;
  const all = report.vulnerabilities;
  const fixable = (name, seen = new Set()) => {
    const v = all[name];
    if (!v || seen.has(name)) return true;
    seen.add(name);
    const nonMajor = v.fixAvailable === true || v.fixAvailable?.isSemVerMajor === false;
    return nonMajor && (v.via ?? []).every((x) => typeof x !== "string" || fixable(x, seen));
  };
  return Object.entries(all)
    .filter(([name, v]) => (v.severity === "critical" || v.severity === "high") && (!only || only.has(name)) && fixable(name))
    .map(([name, v]) => `${name} (${v.severity})`);
}

/**
 * Names of the packages whose lockfile entry is new or differs between two lockfiles.
 * @param {string} baseLock
 * @param {string} headLock
 * @returns {Set<string> | null} null when either is not a lockfile
 */
export function touchedPackages(baseLock, headLock) {
  try {
    const base = JSON.parse(baseLock).packages;
    const head = JSON.parse(headLock).packages;
    if (typeof base !== "object" || typeof head !== "object" || !base || !head) return null;
    const touched = new Set();
    for (const [key, entry] of Object.entries(head)) {
      if (JSON.stringify(entry) !== JSON.stringify(base[key])) touched.add(key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length));
    }
    return touched;
  } catch {
    return null;
  }
}

/**
 * @param {() => string} audit `npm audit --omit=dev --json`'s stdout, which npm prints on a nonzero exit too
 * @param {(line: string) => void} [log]
 * @param {Set<string> | null} [only] see `fixableSevere`
 */
export function run(audit, log = console.log, only = null) {
  let report = null;
  try {
    report = JSON.parse(audit());
  } catch {
    report = null;
  }
  const bad = fixableSevere(report, only);
  if (bad === null) {
    log("npm audit printed no report; cannot tell whether the lockfile is clean");
    return 1;
  }
  log(bad.length ? `fixable without a major bump: ${bad.join(", ")}` : "no critical or high advisory with a non-major fix");
  return bad.length ? 1 : 0;
}

const npmAudit = () => {
  try {
    return runBin("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return String(err.stdout ?? "");
  }
};

/** The packages a pull request's lockfile touches; null (audit everything) when there is no base or it cannot be read. */
function touchedSince(ref) {
  if (!ref) return null;
  try {
    const base = execFileSync("git", ["show", `${ref}:package-lock.json`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    return touchedPackages(base, readFileSync("package-lock.json", "utf8"));
  } catch {
    return null;
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const at = process.argv.indexOf("--base");
  process.exitCode = run(npmAudit, console.log, touchedSince(at > 0 ? process.argv[at + 1] : null));
}
