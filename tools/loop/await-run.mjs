/**
 * Waits on GitHub Actions runs and returns before the default Bash timeout, so a device run's wait
 * is re-issued rather than killed mid-wait. Exit 0: every run passed. 1: one did not. 2: gh cannot
 * find a run. 3: still going.
 */
import { execFileSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { BASH_DEFAULT_TIMEOUT_MS } from "./queue-loop.mjs";

export const BUDGET_MS = BASH_DEFAULT_TIMEOUT_MS - 60_000;
export const EVERY_MS = 30_000;

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

export async function awaitRuns(
  ids,
  { view = ask, pause = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, budgetMs = BUDGET_MS, everyMs = EVERY_MS, say = console.log } = {},
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
