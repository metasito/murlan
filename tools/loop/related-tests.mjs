/** The native jest files a change reaches first; ci.yml's native job runs the rest (RULES.md 3). */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { budgetLines } from "../ci/native-budget.mjs";

import { capNear, CODE, listedTests, localProjectOf, nearTests, onLocalProjects } from "./near-tests.mjs";

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
      console.log(`native budget — information only, CI's run judges (tools/ci/native-budget.mjs):`);
      console.log(budgetLines(JSON.parse(readFileSync(out, "utf8")), localProjectOf, process.cwd()).join("\n"));
    }
    process.exit(status ?? 1);
  }
}
