/** node:test's side of tools/ci/results-writer.mjs: `--test-reporter=./tools/ci/results-node-reporter.mjs`. */
import { openResults, repoPath } from "./results-writer.mjs";

const FILTER = /^--test-(name-pattern|skip-pattern|only|shard)\b/;
const filters = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/)].filter((a) => FILTER.test(a));
// At import, not in the generator: the runner imports its reporters before it spawns a test file.
const out = openResults("node", process.env, filters);

/** @param {AsyncIterable<{ type: string, data: any }>} source */
export default async function* results(source) {
  /** @type {Map<string, string[]>} title path per file, by nesting */
  const stacks = new Map();
  let summary;
  for await (const { type, data } of source) {
    if (type === "test:summary" && data.file === undefined) summary = data;
    if (!data?.file || (type !== "test:start" && type !== "test:pass" && type !== "test:fail")) continue;
    const stack = stacks.get(data.file) ?? [];
    stacks.set(data.file, stack);
    if (type === "test:start") {
      stack.length = data.nesting;
      stack.push(data.name);
      continue;
    }
    const status = data.todo ? "todo" : data.skip ? "skipped" : type === "test:fail" ? "failed" : "passed";
    const title = [...stack.slice(0, data.nesting), data.name].join(" › ");
    // A file whose every test was filtered away still passes, as a test named by its own path.
    const wrapper = data.details?.type === "suite" || (data.nesting === 0 && data.name === data.file);
    out.write({ type: "test", file: repoPath(data.file), title, status, ...(wrapper && { suite: true }) });
  }
  out.write({ type: "end", ok: summary?.success === true, counts: summary?.counts });
}
