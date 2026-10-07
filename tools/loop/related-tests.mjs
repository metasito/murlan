/** The native jest files a change reaches first; ci.yml's native job runs the rest (RULES.md 3). */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

import { capNear, CODE, listedTests, nearTests } from "./near-tests.mjs";

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
    ? execFileSync(process.execPath, [jest, "--listTests", "--findRelatedTests", ...code, "--selectProjects", "ios"], { encoding: "utf8" })
    : "";
  const related = listedTests(listed, process.cwd());
  const near = nearTests({ changed, related, source: (f) => readFileSync(f, "utf8") });
  const { run, left } = capNear(near);
  console.log(`native:related — ${run.length} near of ${related.length} reached; ci.yml's native job runs the rest`);
  if (left) console.log(left);
  if (run.length) process.exit(spawnSync(process.execPath, [jest, ...run, "--selectProjects", "ios"], { stdio: "inherit" }).status ?? 1);
}
