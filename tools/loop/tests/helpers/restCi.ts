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

type View = {
  headRefOid?: string;
  state?: string;
  mergeable?: string;
  mergeStateStatus?: string;
  autoMergeRequest?: unknown;
  statusCheckRollup?: { name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; startedAt?: string; completedAt?: string }[];
};

/** A recorded `gh pr view` as the three REST reads `landingView` makes of it. */
export const restLanding = (view: View) => {
  const lower = (s?: string | null) => (s ? s.toLowerCase() : null);
  const entries = view.statusCheckRollup ?? [];
  return {
    pull: {
      head: { sha: view.headRefOid },
      state: view.state === "OPEN" ? "open" : "closed",
      merged_at: view.state === "MERGED" ? "2026-10-12T00:00:00Z" : null,
      mergeable: view.mergeable === "MERGEABLE" ? true : view.mergeable === "CONFLICTING" ? false : null,
      mergeable_state: lower(view.mergeStateStatus) ?? "unknown",
      auto_merge: view.autoMergeRequest ?? null,
    },
    checks: [
      {
        check_runs: entries
          .filter((e) => e.name)
          .map((e) => ({ name: e.name, status: lower(e.status), conclusion: lower(e.conclusion), details_url: e.detailsUrl, started_at: e.startedAt, completed_at: e.completedAt })),
      },
    ],
    status: { statuses: entries.filter((e) => e.context).map((e) => ({ context: e.context, state: lower(e.state) })) },
  };
};

/** The answer to one of `landingView`'s reads, or null when `args` is none of them. */
export const landingAnswer = (args: string[], view: View): string | null => {
  const kind = ciCall(args)?.kind;
  const rest = restLanding(view);
  if (kind === "pull") return JSON.stringify(rest.pull);
  if (kind === "check-runs") return JSON.stringify(rest.checks);
  if (kind === "status") return JSON.stringify(rest.status);
  return null;
};

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
  if ((m = /\/pulls\/(\d+)$/.exec(bare)) && method === "GET") return { kind: "pull", id: Number(m[1]), query };
  if (/\/commits\/[^/]+\/check-runs$/.test(bare)) return { kind: "check-runs", query };
  if (/\/commits\/[^/]+\/status$/.test(bare)) return { kind: "status", query };
  if ((m = /\/commits\/([^/]+)\/pulls$/.exec(bare))) return { kind: "commit-pulls", query };
  if ((m = /\/commits\/([^/]+)$/.exec(bare))) return { kind: "commit", query };
  if ((m = /\/issues\/(\d+)\/comments$/.exec(bare))) return { kind: method === "POST" ? "comment" : "comments", id: Number(m[1]), query };
  if ((m = /\/issues\/(\d+)$/.exec(bare))) return { kind: method === "PATCH" ? "edit-issue" : "issue", id: Number(m[1]), query };
  if (/\/issues$/.test(bare)) return { kind: method === "POST" ? "create" : "issues", query };
  return null;
}

/** A REST field's value, `name=value` after `-f` or `-F`. */
export const fieldOf = (args: string[], name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
