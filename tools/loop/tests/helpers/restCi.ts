/**
 * The REST shapes `tracker.mjs` reads CI runs from, built from the rows the loop's own code keeps,
 * so a fake `gh` can be seeded with what a test means and answer what the tracker asks.
 */

type Run = { databaseId: number; status?: string; conclusion?: string | null; headSha?: string; attempt?: number; url?: string };
type Job = {
  name: string;
  conclusion: string | null;
  status?: string;
  id?: number;
  databaseId?: number;
  steps?: number | { name?: string; conclusion?: string | null }[];
  failedSteps?: string[];
};

export const restRun = (r: Run) => ({
  id: r.databaseId,
  status: r.status,
  conclusion: r.conclusion ?? null,
  head_sha: r.headSha,
  run_attempt: r.attempt ?? 1,
  html_url: r.url,
});

const stepsOf = (j: Job) => {
  if (Array.isArray(j.steps)) return j.steps.map((s) => ({ name: s?.name, conclusion: s?.conclusion ?? null }));
  const failed = (j.failedSteps ?? []).map((name) => ({ name, conclusion: "failure" }));
  const rest = Array.from({ length: Math.max(0, (j.steps ?? 0) - failed.length) }, (_, i) => ({ name: `step ${i}`, conclusion: "success" }));
  return [...rest, ...failed];
};

/** One page, as `--paginate --slurp` wraps it. */
export const restJobs = (jobs: Job[]) => [
  { total_count: jobs.length, jobs: jobs.map((j) => ({ name: j.name, status: j.status ?? "completed", conclusion: j.conclusion, id: j.id ?? j.databaseId, steps: stepsOf(j) })) },
];

export const restRuns = (runs: Run[]) => ({ total_count: runs.length, workflow_runs: runs.map(restRun) });

/** What a tracker call asks for, from its REST path; null for anything else. */
export function ciCall(args: string[]): { kind: string; id?: number; attempt?: number; query: URLSearchParams } | null {
  if (args[0] !== "api") return null;
  const path = String(args.find((a) => a.startsWith("repos/")) ?? "");
  const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
  const query = new URLSearchParams(path.split("?")[1] ?? "");
  const bare = path.split("?")[0];
  let m: RegExpExecArray | null;
  if ((m = /\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?\/jobs$/.exec(bare))) return { kind: "jobs", id: Number(m[1]), attempt: m[2] ? Number(m[2]) : undefined, query };
  if ((m = /\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?$/.exec(bare))) return { kind: "run", id: Number(m[1]), attempt: m[2] ? Number(m[2]) : undefined, query };
  if (/\/actions\/workflows\/ci\.yml\/runs$/.test(bare)) return { kind: "runs", query };
  if ((m = /\/check-runs\/(\d+)\/annotations$/.exec(bare))) return { kind: "annotations", id: Number(m[1]), query };
  if ((m = /\/commits\/([^/]+)\/pulls$/.exec(bare))) return { kind: "commit-pulls", query };
  if ((m = /\/commits\/([^/]+)$/.exec(bare))) return { kind: "commit", query };
  if ((m = /\/issues\/(\d+)\/comments$/.exec(bare))) return { kind: method === "POST" ? "comment" : "comments", id: Number(m[1]), query };
  if ((m = /\/issues\/(\d+)$/.exec(bare))) return { kind: method === "PATCH" ? "edit-issue" : "issue", id: Number(m[1]), query };
  if (/\/issues$/.test(bare)) return { kind: method === "POST" ? "create" : "issues", query };
  return null;
}

/** A REST field's value, `name=value` after `-f` or `-F`. */
export const fieldOf = (args: string[], name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
