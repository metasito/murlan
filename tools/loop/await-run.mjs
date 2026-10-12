/**
 * Waits on GitHub Actions runs and returns before the default Bash timeout, so a device run's wait
 * is re-issued rather than killed mid-wait. Exit 0: every run passed. 1: one did not, or with
 * `--pr <n>` a passed run is over budget on a test file that pull request changes (RULES.md 46).
 * 2: gh cannot find a run. 3: still going.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { REPO } from "./loop-derive.mjs";
import { BASH_DEFAULT_TIMEOUT_MS } from "./queue-loop.mjs";

export const BUDGET_MS = BASH_DEFAULT_TIMEOUT_MS - 60_000;
export const EVERY_MS = 30_000;
/** The budget gate's own reads, inside the minute `BUDGET_MS` leaves under the Bash timeout. */
export const GATE_MS = 45_000;

const NOT_FOUND = /\b404\b|not found|could not find/i;

const ask = (id) =>
  JSON.parse(
    execFileSync("gh", ["run", "view", id, "--json", "status,conclusion,workflowName,url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

function look(view, id) {
  try {
    return { id, ...view(id) };
  } catch (e) {
    const text = String(e?.stderr || e?.message || e);
    const why = text.split("\n").find((l) => l.trim()) ?? "";
    return { id, status: NOT_FOUND.test(text) ? "missing" : "unreachable", workflowName: `run ${id}`, why };
  }
}

/** @returns {{ pr: number | undefined, ids: string[] } | null} */
export function runArgs(argv) {
  argv = argv.flatMap((a) => (a.startsWith("--pr=") ? ["--pr", a.slice("--pr=".length)] : [a]));
  const at = argv.indexOf("--pr");
  const pr = at === -1 ? undefined : argv[at + 1];
  const ids = at === -1 ? argv : argv.filter((_, i) => i !== at && i !== at + 1);
  if (pr !== undefined && !/^\d+$/.test(pr)) return null;
  if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) return null;
  return { pr: pr === undefined ? undefined : Number(pr), ids };
}

/** 1 and the finding when a passed run is over budget on a file the pull request changes, else 0. */
function budgetGate(ids, pr, gh, until, say) {
  // Loaded on use: a static .ts import plus process.exit aborts node on Windows (nodejs/node#56645).
  const { overBudget, budgetReport, ghExecOptions } = createRequire(import.meta.url)("./ciVerdict.ts");
  const run = gh ?? ((args, by) => execFileSync("gh", args, ghExecOptions(by)));
  try {
    for (const id of ids) {
      const found = overBudget(REPO, pr, Number(id), run, until);
      if (found.files.length) {
        say(`run ${id}: ${budgetReport(found)}`);
        return 1;
      }
    }
  } catch (e) {
    say(`run ${ids.join(", ")} passed, but its over-budget lists could not be read: ${String(e?.message ?? e).split("\n")[0]}`);
    return 1;
  }
  return 0;
}

/**
 * @param {string[]} ids
 * @param {{ view?: (id: string) => any, pause?: (ms: number) => Promise<unknown>, now?: () => number, budgetMs?: number,
 *   everyMs?: number, say?: (line: string) => unknown, pr?: number, gh?: (args: string[], until: number) => string }} [options]
 */
export async function awaitRuns(
  ids,
  { view = ask, pause = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, budgetMs = BUDGET_MS, everyMs = EVERY_MS, say = console.log, pr, gh } = {},
) {
  const end = now() + budgetMs;
  for (;;) {
    const runs = ids.map((id) => look(view, id));
    const missing = runs.filter((r) => r.status === "missing");
    if (missing.length) {
      for (const r of missing) say(`run ${r.id}: gh cannot find it (${r.why}). Check the id and the repository.`);
      return 2;
    }
    const failed = runs.find((r) => r.status === "completed" && r.conclusion !== "success");
    const open = runs.filter((r) => r.status !== "completed");
    if (failed || !open.length) {
      for (const r of runs) say(`${r.workflowName} ${r.id}: ${r.conclusion || r.status} ${r.url ?? ""}`);
      if (failed) return 1;
      return pr === undefined ? 0 : budgetGate(ids, pr, gh, Date.now() + GATE_MS, say);
    }
    if (now() + everyMs > end) {
      say(`Still going: ${open.map((r) => `${r.workflowName} ${r.id} (${r.why ?? r.status})`).join(", ")}. Run the same command again.`);
      return 3;
    }
    await pause(everyMs);
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const parsed = runArgs(process.argv.slice(2));
  if (!parsed) {
    console.error("usage: node tools/loop/await-run.mjs [--pr <n>] <run-id> [<run-id>…]");
    process.exit(2);
  }
  process.exit(await awaitRuns(parsed.ids, { pr: parsed.pr }));
}
