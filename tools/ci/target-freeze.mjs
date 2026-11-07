/**
 * The Target freeze of ci.yml (RULES.md 52). Base's copy of this file, run in the head checkout,
 * judges base...HEAD, so a change cannot loosen the list it is judged by; head's copy runs only as
 * --bootstrap, while base has none. It runs before npm ci, so it imports only node: modules and
 * repository files that do the same.
 */
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { git } from "../loop/cli.mjs";

/**
 * CODEOWNERS patterns: a trailing `/` is a directory, a pattern holding `/` is anchored at the root,
 * one without matches a file name anywhere, and `*` stays inside one path segment.
 */
export const TARGETS = Object.freeze([
  { pattern: "tests/e2e/fixtures/", what: "the mockups" },
  { pattern: "*.nightly.spec.ts", what: "the parity and pixel specs, with their thresholds" },
  { pattern: "tests/e2e/tiers.mjs", what: "which specs are nightly" },
  { pattern: "tests/e2e/handParity*.spec.ts", what: "the hand's parity specs" },
  { pattern: "tests/e2e/lampSeats.spec.ts", what: "the lamp's floors on pull requests" },
  { pattern: "tests/e2e/helpers/mockupParity.ts", what: "the moments and their per-moment exemptions" },
  { pattern: "tests/e2e/helpers/mockupStage.ts", what: "how the mockup is staged beside the app" },
  { pattern: "tests/e2e/helpers/parityRegions.ts", what: "the regions a moment is read in" },
  { pattern: "tests/e2e/helpers/traceDiff.ts", what: "the trace tolerances" },
  { pattern: "tests/e2e/helpers/reconnectDiff.ts", what: "the reconnect moment's tolerances" },
  { pattern: "tests/e2e/helpers/reconnectParity.ts", what: "the reconnect moment's staging" },
  { pattern: "tests/e2e/helpers/lanternDepartures.ts", what: "where the mockup is made to do what the app does" },
  { pattern: "tests/helpers/lanternFixture.ts", what: "the mockup read as an oracle by unit tests" },
  { pattern: "tests/helpers/clothDepartures.ts", what: "the mockup's cloth lines the app departs from" },
  { pattern: "tests/e2e/helpers/feltParityGrid.ts", what: "the felt and lamp floors across the grid" },
  { pattern: "tests/e2e/helpers/handParity.ts", what: "the hand's tolerances" },
  { pattern: "tests/e2e/helpers/lampSeat.ts", what: "the lamp-over-seat tolerance" },
  { pattern: "tools/ci/feltPixels.mjs", what: "the device felt's pixel thresholds" },
  { pattern: "tools/ci/edgePixels.mjs", what: "the device card edges' pixel thresholds" },
  { pattern: "tools/ci/target-freeze.mjs", what: "this list" },
  { pattern: "tests/tooling/targetFreeze.test.ts", what: "this list's floor and wiring" },
  { pattern: ".github/CODEOWNERS", what: "who reviews this list" },
]);

/** What the targets judge: directories at the repository root. */
export const CODE = Object.freeze(["app/", "components/", "lib/"]);

/** The owner's GitHub login, which authors this repository's pull requests. */
export const OWNER = "@rotonmeta";

const SELF = "tools/ci/target-freeze.mjs";
const CI = ".github/workflows/ci.yml";
export const GUARD_JOB = "secrets";
const GUARD_LABEL = `${CI} (the ${GUARD_JOB} job, which runs this freeze)`;

/** @param {string} pattern */
export function matcher(pattern) {
  const dir = pattern.endsWith("/");
  const body = dir ? pattern.slice(0, -1) : pattern;
  const glob = body
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  const re = new RegExp(`${body.includes("/") ? "^" : "(^|/)"}${glob}${dir ? "/" : "$"}`);
  return (/** @type {string} */ file) => re.test(file);
}

const targetMatchers = TARGETS.map((t) => matcher(t.pattern));
const codeMatchers = CODE.map((dir) => (/** @type {string} */ file) => file.startsWith(dir));

/** @param {string} file */
export const isTarget = (file) => targetMatchers.some((m) => m(file));
/** @param {string} file */
export const isCode = (file) => codeMatchers.some((m) => m(file));

/**
 * @param {string[]} changed
 * @param {string[]} [moved] targets that are not files, already found to have changed
 * @returns {{ ok: boolean, why: string, targets: string[], code: string[] }}
 */
export function freezeVerdict(changed, moved = []) {
  const targets = [...moved, ...changed.filter(isTarget)];
  const code = changed.filter(isCode);
  if (targets.length && code.length) {
    const list = (/** @type {string[]} */ fs) => fs.map((f) => `  ${f}`).join("\n");
    return {
      ok: false,
      why: `this change moves the parity targets and the code they judge together (RULES.md 52).\nTargets:\n${list(targets)}\nCode:\n${list(code)}\nLand the target change as its own pull request, touching nothing under ${CODE.join(", ")}.`,
      targets,
      code,
    };
  }
  const why = targets.length ? `targets only (${targets.length} files)` : changed.length ? "no parity target touched" : "no file changed";
  return { ok: true, why, targets, code };
}

/** Renames off, so a target moved out of its path still counts as touched where it was. */
export function changedSince(base, at = git()) {
  return at.text(["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`]).split("\0").filter(Boolean);
}

/** Each pattern must still name a tracked file, or the list has stopped looking at it. */
export function unmatched(tracked) {
  const seen = (/** @type {(file: string) => boolean} */ m) => tracked.some(m);
  return [...TARGETS.filter((_, i) => !seen(targetMatchers[i])).map((t) => t.pattern), ...CODE.filter((_, i) => !seen(codeMatchers[i]))];
}

/**
 * The text of one job in a workflow, read by indentation so it needs no YAML parser before `npm ci`.
 * @param {string} yml
 * @param {string} job
 */
export function jobText(yml, job) {
  const lines = yml.split("\n");
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^ {0,2}\S/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** @param {string} yml */
export function armed(yml) {
  const job = jobText(yml, GUARD_JOB);
  const gate = jobText(yml, "ci-gate");
  return Boolean(
    job &&
      gate &&
      job.includes(`node "$RUNNER_TEMP/freeze-base/${SELF}" "$BASE"`) &&
      new RegExp(`^ {4}needs: \\[[^\\]]*\\b${GUARD_JOB}\\b`, "m").test(gate) &&
      !/^ {4}if:/m.test(job) &&
      !/continue-on-error/.test(job),
  );
}

export function codeowners() {
  const width = Math.max(...TARGETS.map((t) => t.pattern.length + 1));
  return [
    "# Generated from TARGETS in tools/ci/target-freeze.mjs (RULES.md 52); tests/tooling/targetFreeze.test.ts holds them equal.",
    ...TARGETS.map((t) => `${(t.pattern.includes("/") ? `/${t.pattern}` : t.pattern).padEnd(width)} ${OWNER}`),
    "",
  ].join("\n");
}

/**
 * @param {string | undefined} base
 * @param {ReturnType<typeof git>} at
 * @param {(line: string) => void} log
 * @param {{ bootstrap?: boolean }} [opts]
 */
export function run(base, at = git(), log = console.log, { bootstrap = false } = {}) {
  if (!base) {
    log("::error::target-freeze needs the base commit to diff against.");
    return 1;
  }
  const show = (/** @type {string} */ spec) => {
    try {
      return at.text(["show", spec]);
    } catch {
      return null;
    }
  };
  let changed;
  let same;
  try {
    const missing = unmatched(at.text(["ls-files", "-z"]).split("\0").filter(Boolean));
    if (missing.length) {
      log(`::error::these patterns name no tracked file, so the freeze no longer sees them: ${missing.join(", ")}`);
      return 1;
    }
    changed = changedSince(base, at);
    same = at.text(["rev-parse", "--verify", `${base}^{commit}`]).trim() === at.text(["rev-parse", "HEAD"]).trim();
  } catch (err) {
    log(`::error::no change set from ${base}: ${String(err?.message ?? err).split("\n")[0]}`);
    return 1;
  }
  if (same) {
    log(`::error::${base} is the commit under judgement, so there is no change set to judge.`);
    return 1;
  }
  if (bootstrap && show(`${base}:${SELF}`) !== null) {
    log(`::error::${base} carries ${SELF}, so its copy judges this change, not this one.`);
    return 1;
  }
  const headCi = show(`HEAD:${CI}`) ?? "";
  if (!armed(headCi)) {
    log(`::error::${CI} no longer runs base's copy of the freeze in a gated ${GUARD_JOB} job.`);
    return 1;
  }
  const moved = jobText(show(`${base}:${CI}`) ?? "", GUARD_JOB) === jobText(headCi, GUARD_JOB) ? [] : [GUARD_LABEL];
  const verdict = freezeVerdict(changed, moved);
  log(verdict.ok ? verdict.why : `::error::${verdict.why}`);
  return verdict.ok ? 0 : 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const bootstrap = process.argv[2] === "--bootstrap";
  process.exitCode = run(process.argv[bootstrap ? 3 : 2], git(), console.log, { bootstrap });
}
