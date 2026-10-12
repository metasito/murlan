/** The native jest files a change reaches first; ci.yml's native job runs the rest (RULES.md 3). */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { budgetLines } from "../ci/native-budget.mjs";

export const NATIVE_TEST = /^tests\/native\/.+\.test\.tsx$/;
export const CODE = /\.(tsx?|m?js)$/;
export const LOCAL_PROJECTS = ["ios", "compiled"];

/** @param {string[]} args */
export const onLocalProjects = (args) => [...args, "--selectProjects", ...LOCAL_PROJECTS];

/** @param {string} file absolute */
export function localProjectOf(file) {
  const require = createRequire(import.meta.url);
  const { globsToMatcher } = require(require.resolve("jest-util", { paths: [require.resolve("jest")] }));
  const { projects } = require("../../jest.config.js");
  return projects.find((p) => LOCAL_PROJECTS.includes(p.displayName) && globsToMatcher(p.testMatch)(file))?.displayName;
}
const stem = (f) =>
  path.posix.basename(f).replace(/\.test\.tsx$/, "").replace(/(\.(web|native|ios|android))?\.(tsx?|m?js)$/, "");

/**
 * Changed test files first, then tests named after a changed module, then importers: `capNear`
 * keeps the head of this order.
 *
 * @param {{changed: string[], related: string[], source: (file: string) => string}} io
 */
export function nearTests({ changed, related, source }) {
  const modules = changed.filter((f) => CODE.test(f) && !NATIVE_TEST.test(f));
  const specs = modules.map((m) => `@/${m.replace(CODE, "")}`);
  const stems = new Set(modules.map(stem));
  const named = related.filter((t) => stems.has(stem(t)));
  const importers = related.filter((t) => specs.some((s) => source(t).includes(`'${s}'`) || source(t).includes(`"${s}"`)));
  return [...new Set([...changed.filter((f) => NATIVE_TEST.test(f)).sort(), ...named.sort(), ...importers.sort()])];
}

export const NEAR_CAP = 10;

/** @param {string[]} tests in priority order */
export function capNear(tests, cap = NEAR_CAP) {
  return { run: tests.slice(0, cap), left: tests.length > cap ? `… ${tests.length - cap} more left to ci.yml native` : null };
}

/** jest `--listTests` prints a project banner among the absolute paths. */
export function listedTests(out, cwd) {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((f) => path.isAbsolute(f))
    .map((f) => path.relative(cwd, f).replaceAll("\\", "/"));
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const lines = (...a) => execFileSync("git", a, { encoding: "utf8" }).split("\n").filter(Boolean);
  const changed = [
    ...new Set([
      ...lines("diff", "--name-only", "origin/main...HEAD"),
      ...lines("diff", "--name-only", "HEAD"),
      ...lines("ls-files", "--others", "--exclude-standard"),
    ]),
  ].filter((f) => existsSync(f));
  const jest = path.join(path.dirname(createRequire(import.meta.url).resolve("jest/package.json")), "bin", "jest.js");
  const code = changed.filter((f) => CODE.test(f));
  const listed = code.length
    ? execFileSync(process.execPath, [jest, ...onLocalProjects(["--listTests", "--findRelatedTests", ...code])], { encoding: "utf8" })
    : "";
  const related = listedTests(listed, process.cwd());
  const near = nearTests({ changed, related, source: (f) => readFileSync(f, "utf8") });
  const { run, left } = capNear(near);
  console.log(`native:related — ${run.length} near of ${related.length} reached; ci.yml's native job runs the rest`);
  if (left) console.log(left);
  if (run.length) {
    const out = path.join(".loop-logs", "native-related.json");
    mkdirSync(".loop-logs", { recursive: true });
    rmSync(out, { force: true });
    const status = spawnSync(process.execPath, [jest, ...onLocalProjects([...run, "--json", `--outputFile=${out}`])], { stdio: "inherit" }).status;
    if (existsSync(out)) {
      console.log(`native budget — CI's run judges (tools/ci/native-budget.mjs); a file marked at risk is shrunk or split before review:`);
      console.log(budgetLines(JSON.parse(readFileSync(out, "utf8")), localProjectOf, process.cwd(), changed).join("\n"));
    }
    process.exit(status ?? 1);
  }
}
