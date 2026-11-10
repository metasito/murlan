/**
 * RULES.md 52, run by .github/workflows/target-freeze.yml from the base branch's checkout. The pull
 * request's head is read as git objects. Its copy of this module is evaluated only to read its list,
 * in a Node process under the permission model with read access to a scratch copy and nothing else
 * (listAt), so a head cannot change the list or the verdict that judges it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { git } from "../loop/cli.mjs";
import { matcher } from "./codeowners.mjs";

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
  { pattern: "tests/helpers/phoneTable.ts", what: "the table layout and insets the lamp is measured against" },
  { pattern: "tests/e2e/helpers/cardOnCardCss.ts", what: "how the mockup draws a card's shadow on a card" },
  { pattern: "tests/e2e/helpers/phones.ts", what: "the viewports every spec is measured at" },
  { pattern: "tests/e2e/helpers/settle.ts", what: "when a spec decides the table has stopped moving" },
  { pattern: "tests/e2e/helpers/safeArea.ts", what: "the insets a spec measures under" },
  { pattern: "tests/e2e/helpers/skiaPerfBudgets.ts", what: "the Skia table's speed budgets" },
  { pattern: "tests/e2e/skiaPerf.spec.ts", what: "the windows, throttle and seed the speed budgets are read in" },
  { pattern: "tests/e2e/tableAtRest.spec.ts", what: "what a settled table may still draw, counted per stepped frame" },
  { pattern: "tools/ci/target-freeze.mjs", what: "this list" },
  { pattern: "tools/ci/codeowners.mjs", what: "how this list's patterns match, here and in the verdict" },
  { pattern: ".github/workflows/target-freeze.yml", what: "the workflow that runs this list" },
  { pattern: "tests/tooling/targetFreeze.test.ts", what: "this list's floor and the workflow's shape" },
  { pattern: ".github/CODEOWNERS", what: "who reviews this list" },
]);

/**
 * Reviewed by OWNER like a target but frozen with nothing (RULES.md 53): what decides whether a
 * test result counts, which a change to the code under test routinely touches beside it.
 */
export const JUDGES = Object.freeze([
  { pattern: "tools/ci/test-verdict.mjs", what: "the verdict over every runner's results" },
  { pattern: "tools/ci/quarantine.json", what: "the skips the verdict excuses" },
  { pattern: "tools/ci/results-*.mjs", what: "the runners' results reporters" },
  { pattern: "tools/ci/gate.mjs", what: "the needs CI gate requires" },
  { pattern: "tools/ci/scope*.mjs", what: "which suites a change runs" },
  { pattern: "tests/tooling/testVerdict.test.ts", what: "the plants the verdict reds on" },
  { pattern: ".github/workflows/ci.yml", what: "the jobs, their uploads and the gate that reads them" },
  { pattern: "package.json", what: "the node runs' reporters, results among them" },
  { pattern: "scripts/nodeTest.mjs", what: "the launcher the node runs and their reporters go through" },
  { pattern: "jest.config.js", what: "the native run's reporters, results among them" },
  { pattern: "tests/e2e/playwright*.config.ts", what: "the browser runs' reporters and their forbidOnly" },
  { pattern: "tools/ci/e2e-budget.mjs", what: "a reporter the browser runs' results pass through" },
  { pattern: "tools/ci/native-budget.mjs", what: "a reporter the native run's results pass through" },
  { pattern: "tools/ci/preflightMemory.mjs", what: "the native and browser runs' globalSetup" },
  { pattern: "tools/ci/e2eGlobalTimeout.mjs", what: "imported by the browser runs' config" },
  { pattern: "tests/e2e/helpers/voteDeadline.ts", what: "imported by the browser runs' config" },
  { pattern: "tests/helpers/fileDeadline.mjs", what: "imported into every node test process" },
  { pattern: "tests/helpers/timeoutHeadroomReporter.mjs", what: "a reporter the node runs' results pass through" },
  { pattern: "tests/helpers/timeoutHeadroom.mjs", what: "imported by a node runs' reporter" },
  { pattern: "tests/helpers/filesRunReporter.mjs", what: "a reporter the node runs' results pass through" },
  { pattern: "tests/helpers/exitGuard.mjs", what: "imported by a node runs' reporter" },
  { pattern: "tools/loop/tests/helpers/clearLoopEnv.mjs", what: "imported into every harness test process" },
  { pattern: "tools/loop/session-env.mjs", what: "imported by the node runs' launcher" },
  { pattern: "tools/loop/limits.mjs", what: "imported by the browser runs' config" },
  { pattern: "scripts/lib/entry.mjs", what: "imported by the node runs' launcher" },
  { pattern: "scripts/lib/proc.mjs", what: "imported by the node runs' launcher" },
  { pattern: "tests/native/harness/timeoutHeadroomEnvironment.mjs", what: "the native run's testEnvironment" },
  { pattern: "tests/native/setup.ts", what: "the native run's setupFilesAfterEnv" },
  { pattern: "tests/native/harness/assetRegistry.ts", what: "a module the native run's moduleNameMapper maps to" },
  { pattern: "tests/native/fabricIntProps.ts", what: "imported by the native run's setup" },
  { pattern: "tests/native/helpers/frames.ts", what: "imported by the native run's setup" },
  { pattern: "tests/native/harness/env.ts", what: "imported by the native run's setup" },
  { pattern: "tests/native/mocks/*", what: "the module mocks the native run's setup installs" },
  { pattern: "tests/helpers/processWorlds.ts", what: "the process worlds the runners' process-tree tests run in" },
  { pattern: "tests/tooling/proc.test.ts", what: "the plants the runners' process-tree ending is held to" },
  { pattern: "tests/tooling/testHangs.test.ts", what: "the plants the runners' stall and exit guards are held to" },
  { pattern: "tests/e2e/seatNameContrast.spec.ts", what: "the lit seat name's regression floor" },
  { pattern: "tests/tooling/litFloor.test.ts", what: "the floor held equal to its ruling" },
  { pattern: "docs/GAME-RULES.md", what: "the rulings the floors are held to" },
]);

export const CODE = Object.freeze(["app/", "components/", "lib/"]);

export const OWNER = "@rotonmeta";

export const WORKFLOW = ".github/workflows/target-freeze.yml";
const SANDBOXED_NODE = 25;
const SELF = "tools/ci/target-freeze.mjs";
export const CHECK = "Target freeze";

export { matcher };

const targetMatchers = TARGETS.map((t) => matcher(t.pattern));
const codeMatcher = (/** @type {string} */ dir) => (/** @type {string} */ file) => file.startsWith(dir) && !file.endsWith(".md");
const codeMatchers = CODE.map(codeMatcher);

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

/**
 * Each pattern of the list must still name a file in the tree, or the list has stopped looking at it.
 * @param {string[]} tracked
 * @param {{ targets: string[], code: string[] }} list
 */
export function unmatched(tracked, list = { targets: TARGETS.map((t) => t.pattern), code: [...CODE] }) {
  const seen = (/** @type {(file: string) => boolean} */ m) => tracked.some(m);
  return [...list.targets.filter((p) => !seen(matcher(p))), ...list.code.filter((d) => !seen(codeMatcher(d)))];
}

/**
 * The list as head's own copy of this module holds it, evaluated by Node's permission model with
 * read access to a scratch copy of the module's imports and nothing else, never from the checkout.
 * @param {string} head
 * @param {ReturnType<typeof git>} at
 * @returns {{ targets: string[], code: string[] }}
 */
export function listAt(head, at, node = process.versions.node) {
  const major = Number(node.split(".")[0]);
  if (major < SANDBOXED_NODE) throw new Error(`Node ${node} does not deny the network under --permission; evaluating head's list needs Node ${SANDBOXED_NODE} or later`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "target-freeze-head-"));
  try {
    const seen = new Set();
    const queue = [SELF];
    while (queue.length) {
      const file = /** @type {string} */ (queue.pop());
      if (seen.has(file)) continue;
      seen.add(file);
      const text = at.text(["show", `${head}:${file}`]);
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
      for (const [, spec] of text.matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)) queue.push(path.posix.join(path.posix.dirname(file), spec));
    }
    const reader = path.join(dir, "read-list.mjs");
    fs.writeFileSync(reader, `const { TARGETS, CODE } = await import(${JSON.stringify(path.join(dir, SELF))});\nprocess.stdout.write(JSON.stringify({ targets: TARGETS.map((t) => t.pattern), code: [...CODE] }));\n`);
    const r = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${fs.realpathSync(dir)}`, reader], { encoding: "utf8", env: {}, timeout: 20000 });
    if (r.status !== 0) throw new Error(`${head}'s ${SELF} did not evaluate to a list: ${String(r.stderr).split("\n").find((l) => /Error/.test(l)) ?? r.status}`);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  const owned = [...TARGETS, ...JUDGES];
  const width = Math.max(...owned.map((t) => t.pattern.length + 1));
  return [
    "# Generated from TARGETS and JUDGES in tools/ci/target-freeze.mjs (RULES.md 52, 53); tests/tooling/targetFreeze.test.ts holds them equal.",
    ...owned.map((t) => `${(t.pattern.includes("/") ? `/${t.pattern}` : t.pattern).padEnd(width)} ${OWNER}`),
    "",
  ].join("\n");
}

/**
 * @param {string | undefined} base
 * @param {string | undefined} head
 * @param {ReturnType<typeof git>} at
 * @param {(line: string) => void} log
 * @param {string} node
 */
export function run(base, head, at = git(), log = console.log, node = process.versions.node) {
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
    if (!at.text(["ls-tree", "-z", "--name-only", head, "--", SELF]).includes(SELF)) {
      log(`::error::${head} has no ${SELF}, so no list would judge the pull requests after it.`);
      return 1;
    }
    const headFiles = at.text(["ls-tree", "-r", "-z", "--name-only", head]).split("\0").filter(Boolean);
    let headList;
    try {
      headList = listAt(head, at, node);
    } catch (err) {
      log(`::error::could not evaluate ${head}'s target list: ${String(err?.message ?? err).split("\n")[0]}`);
      return 1;
    }
    const emptied = unmatched(headFiles, headList);
    if (emptied.length) {
      log(`::error::these patterns name no file in ${head} but its list still holds them, so every later pull request would be refused: ${emptied.join(", ")}`);
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
      log(`::error::${spoofs.join(", ")} ${spoofs.length === 1 ? "names" : "name"} a job or step ${CHECK}: a job so named reports a check that would stand in for this one, and a step so named is refused because the scan cannot tell it from a job (RULES.md 52).`);
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
