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
  /** @type {Map<string, { file: string, title: string }[]>} enqueued, not yet passed or failed */
  const pending = new Map();
  const at = (/** @type {any} */ data) => `${data.file}\0${data.nesting}\0${data.name}`;
  let summary;
  for await (const { type, data } of source) {
    if (type === "test:summary" && data.file === undefined) summary = data;
    if (!data?.file || !["test:enqueue", "test:start", "test:pass", "test:fail"].includes(type)) continue;
    const stack = stacks.get(data.file) ?? [];
    stacks.set(data.file, stack);
    const title = [...stack.slice(0, data.nesting), data.name].join(" › ");
    // The file's own wrapper, named by its path relative to the working directory while `file` is
    // absolute: it passes for a file that registered no test, or exited before reporting any.
    const fileWrapper = data.nesting === 0 && repoPath(data.name) === repoPath(data.file);
    if (type === "test:enqueue") {
      if (!fileWrapper) pending.set(at(data), [...(pending.get(at(data)) ?? []), { file: repoPath(data.file), title }]);
      continue;
    }
    if (type === "test:start") {
      stack.length = data.nesting;
      stack.push(data.name);
      continue;
    }
    pending.get(at(data))?.shift();
    const status = data.todo ? "todo" : data.skip ? "skipped" : type === "test:fail" ? "failed" : "passed";
    const wrapper = data.details?.type === "suite" || fileWrapper;
    out.write({ type: "test", file: repoPath(data.file), title, status, ...(wrapper && { suite: true }) });
  }
  // A file that exits mid-run still reports a green summary, and never mentions the tests it cut off.
  for (const t of [...pending.values()].flat()) out.write({ type: "test", ...t, title: `${t.title} (exited before it finished)`, status: "failed" });
  out.write({ type: "end", ok: summary?.success === true, counts: summary?.counts });
}
