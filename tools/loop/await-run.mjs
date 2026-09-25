/**
 * Waits on GitHub Actions runs and returns before the Bash ceiling, so a device run's wait is
 * re-issued rather than killed mid-wait. Exit 0: every run passed. 1: one did not. 3: still going.
 */
import { execFileSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { CHECK_BASH_TIMEOUT_MS } from "./queue-loop.mjs";

export const BUDGET_MS = CHECK_BASH_TIMEOUT_MS - 3 * 60_000;

const ask = (id) =>
  JSON.parse(execFileSync("gh", ["run", "view", id, "--json", "status,conclusion,workflowName,url"], { encoding: "utf8" }));

function look(view, id) {
  try {
    return { id, ...view(id) };
  } catch (e) {
    return { id, status: "unreachable", workflowName: `run ${id}`, why: String(e?.message ?? e).split("\n")[0] };
  }
}

export async function awaitRuns(
  ids,
  { view = ask, pause = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, budgetMs = BUDGET_MS, everyMs = 60_000, say = console.log } = {},
) {
  const end = now() + budgetMs;
  for (;;) {
    const runs = ids.map((id) => look(view, id));
    const failed = runs.find((r) => r.status === "completed" && r.conclusion !== "success");
    const open = runs.filter((r) => r.status !== "completed");
    if (failed || !open.length) {
      for (const r of runs) say(`${r.workflowName} ${r.id}: ${r.conclusion || r.status} ${r.url ?? ""}`);
      return failed ? 1 : 0;
    }
    if (now() + everyMs > end) {
      say(`Still going: ${open.map((r) => `${r.workflowName} ${r.id} (${r.why ?? r.status})`).join(", ")}. Run the same command again.`);
      return 3;
    }
    await pause(everyMs);
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const ids = process.argv.slice(2);
  if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) {
    console.error("usage: node tools/loop/await-run.mjs <run-id> [<run-id>…]");
    process.exit(2);
  }
  process.exit(await awaitRuns(ids));
}
