/**
 * ci.yml's `CI gate`, the one required check: green only when every job it needs passed or was
 * skipped by scope. A gate over no job at all is red, or a broken `needs` would pass everything.
 */
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

/** @param {(string | undefined)[]} results */
export function gateVerdict(results) {
  if (!results.length) return { ok: false, why: "no job reported" };
  const bad = results.filter((r) => r !== "success" && r !== "skipped");
  return bad.length ? { ok: false, why: `not green: ${bad.join(", ")}` } : { ok: true, why: "every job passed or was skipped by scope" };
}

/**
 * @param {Record<string, string | undefined>} env `NEEDS` is the workflow's `toJSON(needs)`
 * @param {(line: string) => void} log
 */
export function run(env, log = console.log) {
  let needs;
  try {
    needs = JSON.parse(env.NEEDS ?? "{}");
  } catch (err) {
    log(`NEEDS is not JSON (${String(err).split("\n")[0]})`);
    return 1;
  }
  const verdict = gateVerdict(Object.entries(needs ?? {}).map(([job, n]) => (n?.result === "success" || n?.result === "skipped" ? n.result : `${job} ${n?.result}`)));
  log(verdict.why);
  return verdict.ok ? 0 : 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = run(process.env);
