/**
 * RULES.md 52, run by .github/workflows/target-freeze.yml from the base branch's checkout. It reads
 * the pull request's head only as git objects, never as files to run, so a head cannot change the
 * list or the verdict that judges it.
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
  { pattern: "tests/e2e/helpers/tableTrace.ts", what: "the trace every lamp and felt spec reads the app through" },
  { pattern: "tests/e2e/helpers/renderCounters.ts", what: "what the speed budgets count as a render" },
  { pattern: "tests/e2e/helpers/virtualClock.ts", what: "the clock the speed budgets are read in" },
  { pattern: "tests/e2e/helpers/phones.ts", what: "the viewports every spec is measured at" },
  { pattern: "tests/e2e/helpers/settle.ts", what: "when a spec decides the table has stopped moving" },
  { pattern: "tests/e2e/helpers/safeArea.ts", what: "the insets a spec measures under" },
  { pattern: "tests/e2e/helpers/skiaPerfBudgets.ts", what: "the Skia table's speed budgets" },
  { pattern: "tests/e2e/skiaPerf.spec.ts", what: "the windows, throttle and seed the speed budgets are read in" },
  { pattern: "tools/ci/target-freeze.mjs", what: "this list" },
  { pattern: ".github/workflows/target-freeze.yml", what: "the workflow that runs this list" },
  { pattern: "tests/tooling/targetFreeze.test.ts", what: "this list's floor and the workflow's shape" },
  { pattern: ".github/CODEOWNERS", what: "who reviews this list" },
]);

export const CODE = Object.freeze(["app/", "components/", "lib/"]);

export const OWNER = "@rotonmeta";

export const WORKFLOW = ".github/workflows/target-freeze.yml";
const SELF = "tools/ci/target-freeze.mjs";
export const CHECK = "Target freeze";

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
const codeMatchers = CODE.map((dir) => (/** @type {string} */ file) => file.startsWith(dir) && !file.endsWith(".md"));

/** @param {string} file */
export const isTarget = (file) => targetMatchers.some((m) => m(file));
/** @param {string} file */
export const isCode = (file) => codeMatchers.some((m) => m(file));

/**
 * @param {string[]} changed
 * @returns {{ ok: boolean, why: string, targets: string[], code: string[] }}
 */
export function freezeVerdict(changed) {
  const targets = changed.filter(isTarget);
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
export function changedSince(base, head, at = git()) {
  return at.text(["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`]).split("\0").filter(Boolean);
}

/** Each pattern must still name a file in the base, or the list has stopped looking at it. */
export function unmatched(tracked) {
  const seen = (/** @type {(file: string) => boolean} */ m) => tracked.some(m);
  return [...TARGETS.filter((_, i) => !seen(targetMatchers[i])).map((t) => t.pattern), ...CODE.filter((_, i) => !seen(codeMatchers[i]))];
}

/**
 * The workflows other than WORKFLOW that name something CHECK: a check run of theirs answers the
 * ruleset's requirement as the real one does.
 * @param {{ path: string, text: string }[]} workflows
 */
export function impostors(workflows) {
  const named = new RegExp(`^[ \\t-]*name:[ \\t]*(["']?)${CHECK}\\1[ \\t]*(#.*)?$`, "im");
  return workflows.filter((w) => w.path !== WORKFLOW && named.test(w.text)).map((w) => w.path);
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
 * @param {string | undefined} head
 * @param {ReturnType<typeof git>} at
 * @param {(line: string) => void} log
 */
export function run(base, head, at = git(), log = console.log) {
  if (!base || !head) {
    log("::error::target-freeze needs the base and head commits to diff.");
    return 1;
  }
  let changed;
  try {
    const commit = (/** @type {string} */ ref) => at.text(["rev-parse", "--verify", `${ref}^{commit}`]);
    if (commit(base) === commit(head)) {
      log(`::error::${base} is the commit under judgement, so there is no change set to judge.`);
      return 1;
    }
    const missing = unmatched(at.text(["ls-tree", "-r", "-z", "--name-only", base]).split("\0").filter(Boolean));
    if (missing.length) {
      log(`::error::these patterns name no file in ${base}, so the freeze no longer sees them: ${missing.join(", ")}`);
      return 1;
    }
    const kept = at.text(["show", `${head}:${SELF}`]);
    const emptied = unmatched(at.text(["ls-tree", "-r", "-z", "--name-only", head]).split("\0").filter(Boolean)).filter((p) => kept.includes(`"${p}"`));
    if (emptied.length) {
      log(`::error::these patterns name no file in ${head} but its list still holds them, so the freeze would no longer see them: ${emptied.join(", ")}`);
      return 1;
    }
    changed = changedSince(base, head, at);
    const workflows = at
      .text(["ls-tree", "-z", "--name-only", head, "--", ".github/workflows/"])
      .split("\0")
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ path: f, text: at.text(["show", `${head}:${f}`]) }));
    const spoofs = impostors(workflows);
    if (spoofs.length) {
      log(`::error::${spoofs.join(", ")} ${spoofs.length === 1 ? "names" : "name"} a job or step ${CHECK}; a job so named reports a check that would stand in for this one (RULES.md 52).`);
      return 1;
    }
  } catch (err) {
    log(`::error::could not read ${base} or ${head}, or they share no merge base, so nothing was judged: ${String(err?.message ?? err).split("\n")[0]}`);
    return 1;
  }
  const verdict = freezeVerdict(changed);
  log(verdict.ok ? verdict.why : `::error::${verdict.why}`);
  return verdict.ok ? 0 : 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  process.exitCode = run(process.argv[2], process.argv[3]);
}
