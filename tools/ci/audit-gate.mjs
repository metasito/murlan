/**
 * ci.yml's `Audit`: red on a critical or high advisory in production dependencies whose fix is not a
 * major bump. A major is the owner's call and does not fail it. Output that is not an audit report is red.
 */
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { runBin } from "../../scripts/lib/proc.mjs";

/**
 * A package flagged only because of another package (`via` names it) is fixable only when that package is:
 * npm reports `fixAvailable: true` for the dependent while the advisory's own package has no non-major fix.
 * @param {{ vulnerabilities?: Record<string, { severity: string, fixAvailable: unknown, via?: unknown[] }> } | null} report
 */
export function fixableSevere(report) {
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
    .filter(([name, v]) => (v.severity === "critical" || v.severity === "high") && fixable(name))
    .map(([name, v]) => `${name} (${v.severity})`);
}

/** @param {() => string} audit `npm audit --omit=dev --json`'s stdout, which npm prints on a nonzero exit too */
export function run(audit, log = console.log) {
  let report = null;
  try {
    report = JSON.parse(audit());
  } catch {
    report = null;
  }
  const bad = fixableSevere(report);
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

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = run(npmAudit);
