/**
 * GitHub, for the loop: every issue and pull request it reads or moves, and who it trusts, behind
 * one interface — `ghTracker` over `gh api`, `fakeTracker` in memory. The label set is
 * `docs/agents/issue-tracker.md`'s.
 *
 * REST only: `gh issue` and `gh pr` go through GraphQL, which a Claude Code cloud session is refused.
 */
import fs from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { gh as ghCli, REPO, viaCli } from "./cli.mjs";
import { conflictNotePath, noted, parkNotePath, writeNote } from "./loop-logs.mjs";
import { CI_RED_TIMEOUT_MS, REFRESH_TIMEOUT_MS } from "./limits.mjs";

export const TRUSTED_AUTHORS = ["OWNER", "MEMBER", "COLLABORATOR"];

/** The repo is public: every marker parser reads only what this keeps. Either API's spelling. */
export const isTrusted = (/** @type {{authorAssociation?: string, author_association?: string}} */ x) =>
  TRUSTED_AUTHORS.includes(x?.authorAssociation ?? x?.author_association ?? "");

/** @template {{authorAssociation?: string, author_association?: string}} T @param {T[]} comments */
export const trustedComments = (comments) => comments.filter(isTrusted);

/** The jq form, for a session's own read of a thread: either API's spelling of the association. */
export const TRUSTED_SELECT = `select((.authorAssociation//.author_association)|IN(${TRUSTED_AUTHORS.map((a) => `"${a}"`).join(",")}))`;
/** Rule 25's read, keeping only trusted authors' comments: a later comment overrides the body. */
export const readIssue = (n) => `node tools/loop/tracker.mjs read ${n}`;

/** What rule 25's read prints: the title, the body, then each trusted comment as `--- login: body`. */
export function issueText(n, tracker = ghTracker()) {
  const { title, body } = tracker.read(n);
  return [title, body ?? "", ...tracker.comments(n).map((c) => `--- ${c.author.login}: ${c.body}`)].join("\n");
}

export const OWNER_LABELS = new Set(["ready-for-human", "needs-info", "rejected", "deferred"]);

/** `[remove, add]` for each transition, read by both trackers so they cannot drift apart. */
const TRANSITIONS = {
  claim: [[], ["in-progress"]],
  release: [["in-progress"], []],
  // Left on, `ready-for-agent` makes a park absorbing: classify() sends any issue carrying an owner
  // label to the owner bucket whatever else it carries, so the ticket never returns to the frontier.
  park: [["in-progress", "ready-for-agent"], ["ready-for-human"]],
};

const upper = (s) => (s ? String(s).toUpperCase() : null);
const sizeOf = (labels) => labels.find((l) => l.startsWith("size:")) ?? null;

/** @typedef {{body: string, authorAssociation: string, author: {login: string}, createdAt: string}} Comment */
/** @returns {Comment} */
const commentOf = (c) => ({
  body: c.body ?? "",
  authorAssociation: c.author_association ?? "",
  author: { login: c.user?.login ?? "" },
  createdAt: c.created_at ?? "",
});

/** @typedef {{number: number, state: string, headRefName: string|null, headRefOid: string|null, mergedAt: string|null, changedFiles?: number}} Pr */
/** @returns {Pr} */
const prOf = (p) => ({
  number: p.number,
  state: p.merged_at ? "MERGED" : upper(p.state),
  headRefName: p.head?.ref ?? null,
  headRefOid: p.head?.sha ?? null,
  mergedAt: p.merged_at ?? null,
  ...(p.changed_files === undefined ? {} : { changedFiles: p.changed_files }),
});

/**
 * The shape `next-ticket.mjs` routes on.
 * @typedef {{number: number, title: string, author_association?: string, labels: {name: string}[], milestone: {title: string}|null, blocked: boolean}} OpenIssue
 */
const openIssueOf = (i) => ({
  number: i.number,
  title: i.title,
  author_association: i.author_association,
  labels: (i.labels ?? []).map((l) => ({ name: l.name })),
  milestone: i.milestone ? { title: i.milestone.title } : null,
  blocked: (i.issue_dependencies_summary?.blocked_by ?? 0) > 0,
});

/** @typedef {{databaseId: number, status: string, conclusion: string|null, headSha: string, attempt: number, url: string}} CiRun */
/** @returns {CiRun} */
const runOf = (r) => ({ databaseId: r.id, status: r.status, conclusion: r.conclusion ?? null, headSha: r.head_sha, attempt: r.run_attempt, url: r.html_url });

/** @typedef {{number: number, title: string, url: string, state: string, createdAt: string}} Labelled */

/** @typedef {(args: string[], opts?: import("./cli.mjs").RunOptions) => string} Gh */
/** @param {Gh} [gh] */
export function ghTracker(gh = ghCli, repo = REPO) {
  const issues = `repos/${repo}/issues`;
  const pulls = `repos/${repo}/pulls`;
  const actions = `repos/${repo}/actions`;
  const get = (path, opts) => JSON.parse(gh(["api", path], opts));
  // `--slurp` wraps each page, so a listing past one page is read whole rather than cut at its first.
  const all = (path, opts) => JSON.parse(gh(["api", "--paginate", "--slurp", path], opts)).flat();
  const headOf = (branch) => encodeURIComponent(`${repo.split("/")[0]}:${branch}`);

  // One replace of the whole set, so a transition lands whole or not at all: an add and a remove sent
  // apart leave both sets on when the second fails. Labels the transition does not name are kept.
  /** @type {(n: number, change: {add?: string[], remove?: string[]}) => void} */
  const relabel = (n, { add = [], remove = [] }) => {
    const now = get(`${issues}/${n}`).labels.map((l) => l.name);
    const target = [...new Set([...now.filter((l) => !remove.includes(l)), ...add])];
    if (target.length === now.length && target.every((l) => now.includes(l))) return;
    if (target.length === 0) gh(["api", "-X", "DELETE", `${issues}/${n}/labels`]);
    else gh(["api", "-X", "PUT", `${issues}/${n}/labels`, ...target.flatMap((l) => ["-f", `labels[]=${l}`])]);
  };
  const move = (name) => (n) => relabel(n, { remove: TRANSITIONS[name][0], add: TRANSITIONS[name][1] });
  /** @type {(n: number, opts?: {all?: boolean} & import("./cli.mjs").RunOptions) => Comment[]} */
  const comments = (n, { all: everyone = false, ...opts } = {}) => {
    const got = all(`${issues}/${n}/comments?per_page=100`, opts).map(commentOf);
    return everyone ? got : trustedComments(got);
  };

  return {
    claim: move("claim"),
    release: move("release"),
    park: move("park"),
    relabel,
    comment: (n, bodyFile) => void gh(["api", "-X", "POST", `${issues}/${n}/comments`, "-F", `body=@${bodyFile}`]),
    /** @returns {{state: string, labels: string[]}} */
    issue: (n, opts) => {
      const { state, labels } = get(`${issues}/${n}`, opts);
      return { state: upper(state), labels: labels.map((l) => l.name) };
    },
    /** The issue as REST has it: what `next-ticket.mjs` prints for a ticket read in full. */
    read: (n, opts) => get(`${issues}/${n}`, opts),
    /** Trusted comments only, unless `all`. Throws on failure; the caller decides what that means. */
    comments,
    /** One ticket's header facts and trusted comments; null when either cannot be read. */
    facts: (n, opts) => {
      try {
        const i = get(`${issues}/${n}`, opts);
        const labels = i.labels.map((l) => l.name);
        return {
          title: i.title,
          url: i.html_url,
          labels,
          size: sizeOf(labels),
          state: upper(i.state),
          stateReason: upper(i.state_reason),
          comments: comments(n, opts),
        };
      } catch {
        return null;
      }
    },
    /** @returns {{number: number, headRefOid: string|null}|null} */
    openPrFor: (branch, opts) => {
      const [open] = get(`${pulls}?state=open&head=${headOf(branch)}&per_page=1`, opts).map(prOf);
      return open ? { number: open.number, headRefOid: open.headRefOid } : null;
    },
    /** Every state, newest first: with a branch, its own; without, the newest hundred. @returns {Pr[]} */
    prsFor: ({ branch }, opts) =>
      get(branch ? `${pulls}?state=all&head=${headOf(branch)}&per_page=20` : `${pulls}?state=all&per_page=100`, opts).map(prOf),
    /** @returns {Pr} */
    pr: (n, opts) => prOf(get(`${pulls}/${n}`, opts)),
    /** @returns {Pr[]} */
    openPrs: (opts) => all(`${pulls}?state=open&per_page=100`, opts).map(prOf),
    /** @returns {string} the new pull request's URL */
    /** @type {(o: {head: string, title: string, body?: string, bodyFile?: string}, opts?: import("./cli.mjs").RunOptions) => string} the new pull request's URL */
    createPr: ({ head, title, body, bodyFile }, opts) =>
      JSON.parse(
        gh(["api", "-X", "POST", pulls, "-f", "base=main", "-f", `head=${head}`, "-f", `title=${title}`, ...(body === undefined ? ["-F", `body=@${bodyFile}`] : ["-f", `body=${body}`])], opts),
      ).html_url,
    editPr: (n, bodyFile, opts) => void gh(["api", "-X", "PATCH", `${pulls}/${n}`, "-F", `body=@${bodyFile}`], opts),
    /** @returns {OpenIssue[]} */
    openIssues: (opts) => all(`${issues}?state=open&per_page=100`, opts).filter((i) => !i.pull_request).map(openIssueOf),
    /** @type {(o: {title: string, bodyFile?: string, body?: string, labels?: string[]}, opts?: import("./cli.mjs").RunOptions) => string} the new issue's URL */
    createIssue: ({ title, bodyFile, body, labels = [] }, opts) =>
      JSON.parse(
        gh(["api", "-X", "POST", issues, "-f", `title=${title}`, ...(body === undefined ? ["-F", `body=@${bodyFile}`] : ["-f", `body=${body}`]), ...labels.flatMap((l) => ["-f", `labels[]=${l}`])], opts),
      ).html_url,
    /**
     * Issues carrying `label`, newest first: every page, or the newest `limit` alone. REST lists pull
     * requests among issues; they are dropped.
     * @type {(label: string, o?: {state?: "open"|"closed"|"all", limit?: number}, opts?: import("./cli.mjs").RunOptions) => Labelled[]}
     */
    labelled: (label, { state = "open", limit } = {}, opts) => {
      const path = `${issues}?labels=${encodeURIComponent(label)}&state=${state}&per_page=${limit ?? 100}`;
      return (limit ? get(path, opts) : all(path, opts))
        .filter((i) => !i.pull_request)
        .map((i) => ({ number: i.number, title: i.title, url: i.html_url, state: upper(i.state), createdAt: i.created_at }));
    },
    /** ci.yml's runs only — `main` carries other workflows on their own schedule — newest first. */
    /** @type {(q: {branch?: string, commit?: string, status?: string, limit?: number}, opts?: import("./cli.mjs").RunOptions) => CiRun[]} */
    ciRuns: ({ branch, commit, status, limit = 1 }, opts) => {
      const query = [branch && `branch=${encodeURIComponent(branch)}`, commit && `head_sha=${commit}`, status && `status=${status}`, `per_page=${limit}`];
      return get(`${actions}/workflows/ci.yml/runs?${query.filter(Boolean).join("&")}`, opts).workflow_runs.map(runOf);
    },
    /** @type {(id: number, o?: {attempt?: number}, opts?: import("./cli.mjs").RunOptions) => CiRun} */
    run: (id, { attempt } = {}, opts) => runOf(get(`${actions}/runs/${id}${attempt ? `/attempts/${attempt}` : ""}`, opts)),
    /** Every job of the run, or of one attempt, in the shape `gh run view --json jobs` gave them. */
    /** @type {(id: number, o?: {attempt?: number}, opts?: import("./cli.mjs").RunOptions) => {name: string, status: string, conclusion: string|null, databaseId: number, steps: {name: string, conclusion: string|null}[]}[]} */
    runJobs: (id, { attempt } = {}, opts) =>
      JSON.parse(gh(["api", "--paginate", "--slurp", `${actions}/runs/${id}${attempt ? `/attempts/${attempt}` : ""}/jobs?per_page=100`], opts))
        .flatMap((page) => page.jobs ?? [])
        .map((j) => ({
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          databaseId: j.id,
          steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion })),
        })),
    /**
     * A pull request's head, merge state, arming and checks, in the shape `gh pr view --json
     * headRefOid,state,mergeable,mergeStateStatus,autoMergeRequest,statusCheckRollup` gave them:
     * REST's `mergeable_state` is GraphQL's `mergeStateStatus` lower-cased, and the rollup is the
     * head's check runs (every page) beside its commit statuses.
     */
    landingView: (n, opts) => {
      const p = get(`${pulls}/${n}`, opts);
      const sha = p.head.sha;
      const runs = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/commits/${sha}/check-runs?per_page=100`], opts))
        .flatMap((page) => page.check_runs ?? [])
        .map((c) => ({ name: c.name, status: upper(c.status), conclusion: upper(c.conclusion), detailsUrl: c.details_url, startedAt: c.started_at, completedAt: c.completed_at }));
      const statuses = (get(`repos/${repo}/commits/${sha}/status`, opts).statuses ?? []).map((s) => ({ context: s.context, state: upper(s.state), targetUrl: s.target_url }));
      return {
        headRefOid: sha,
        state: p.merged_at ? "MERGED" : String(p.state).toUpperCase(),
        mergeable: p.mergeable === true ? "MERGEABLE" : p.mergeable === false ? "CONFLICTING" : "UNKNOWN",
        mergeStateStatus: upper(p.mergeable_state) ?? "UNKNOWN",
        autoMergeRequest: p.auto_merge ?? null,
        statusCheckRollup: [...runs, ...statuses],
      };
    },
    /** @returns {string[]} */
    annotations: (checkRunId, opts) => get(`repos/${repo}/check-runs/${checkRunId}/annotations`, opts).map((a) => a.message),
    treeOf: (sha, opts) => get(`repos/${repo}/commits/${sha}`, opts).commit.tree.sha,
    /** The head of the pull request `sha` was merged from, or null. */
    prHeadOf: (sha, opts) => get(`repos/${repo}/commits/${sha}/pulls`, opts)[0]?.head?.sha ?? null,
    /** Closed as completed, with `why` as its last comment. */
    /** Closed as completed, with `why`, when given, as its last comment. */
    closeIssue: (n, why, opts) => {
      if (why) gh(["api", "-X", "POST", `${issues}/${n}/comments`, "-f", `body=${why}`], opts);
      gh(["api", "-X", "PATCH", `${issues}/${n}`, "-f", "state=closed", "-f", "state_reason=completed"], opts);
    },
    rerunFailed: (runId, opts) => void gh(["api", "-X", "POST", `repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`], opts),
    updateBranch: (n, opts) => void gh(["api", "-X", "PUT", `${pulls}/${n}/update-branch`], opts),
    arm: (n, sha, bodyFile, opts) => void gh(armArgs(repo, n, sha, bodyFile), opts),
    disarm: (n, opts) => void gh(disarmArgs(repo, n), opts),
    /** Merges now, refused (409) when the head is no longer `sha`: what `--match-head-commit` binds. */
    merge: (n, sha, bodyFile, opts) =>
      void gh(["api", "-X", "PUT", `${pulls}/${n}/merge`, "-f", "merge_method=merge", "-f", `sha=${sha}`, ...(bodyFile ? ["-F", `commit_message=@${bodyFile}`] : [])], opts),
  };
}

/**
 * Auto-merge, the one write here REST cannot make: arming and disarming it exist only as GraphQL
 * mutations, so these stay `gh pr merge`, and a cloud session cannot arm.
 *
 * `--merge`, never `--squash`. `--match-head-commit` sends `expectedHeadOid`, which GitHub checks
 * when it arms: a head that moved past the cleared commit is refused. It is not documented to be
 * checked again at merge time, so the caller disarms before anything can push.
 *
 * @param {string} repo @param {number} prNumber @param {string} sha @param {string} [bodyFile]
 */
export function armArgs(repo, prNumber, sha, bodyFile) {
  return ["pr", "merge", String(prNumber), "--repo", repo, "--auto", "--merge", "--match-head-commit", sha, ...(bodyFile ? ["--body-file", bodyFile] : [])];
}

/** @param {string} repo @param {number} prNumber */
export function disarmArgs(repo, prNumber) {
  return ["pr", "merge", String(prNumber), "--repo", repo, "--disable-auto"];
}

/**
 * Issues and pull requests held in memory; an issue not seeded starts open and unlabelled. Each
 * operation named in `fail` throws and changes nothing. `held(n)` is what a test asserts on.
 *
 * @param {Record<number, {state?: string, stateReason?: string|null, title?: string, labels?: string[], comments?: Partial<Comment>[], milestone?: string, blocked?: boolean}>} [issues]
 * @param {{fail?: string[], prs?: Pr[]}} [opts]
 */
export function fakeTracker(issues = {}, { fail = [], prs = [] } = {}) {
  const held = new Map();
  const at = (n) => {
    if (!held.has(n)) {
      const seed = issues[n] ?? {};
      held.set(n, {
        ...seed,
        state: seed.state ?? "OPEN",
        labels: new Set(seed.labels ?? []),
        thread: (seed.comments ?? []).map((c) => ({ body: "", authorAssociation: "OWNER", author: { login: "owner" }, createdAt: "", ...c })),
        comments: [],
      });
    }
    return held.get(n);
  };
  const refuse = (name, what) => {
    if (fail.includes(name)) throw new Error(`tracker refused ${name}${what === undefined ? "" : ` on ${what}`}`);
  };
  const op = (name, fn) => (n, ...rest) => {
    refuse(name, `#${n}`);
    return fn(at(n), ...rest);
  };
  const applyLabels = (issue, { add = [], remove = [] }) => {
    for (const l of remove) issue.labels.delete(l);
    for (const l of add) issue.labels.add(l);
  };
  /** @type {(n: number, change: {add?: string[], remove?: string[]}) => void} */
  const relabel = op("relabel", applyLabels);
  const move = (name) => op(name, (issue) => applyLabels(issue, { remove: TRANSITIONS[name][0], add: TRANSITIONS[name][1] }));
  const pulls = [...prs];
  /** What a posted comment reads back as: the file's text, as `gh api -F body=@file` sends it; a file never written posts its name. */
  const readBody = (file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return file;
    }
  };
  /** `held(n).comments` keeps what was posted, the thread what a read gets back, as the loop's own trusted comment. */
  const post = (issue, posted, body) => {
    issue.comments.push(posted);
    issue.thread.push({ body, authorAssociation: "OWNER", author: { login: "loop" }, createdAt: "" });
  };
  /** @type {unknown[][]} */
  const writes = [];
  /** @type {(n: number, opts?: {all?: boolean}) => Comment[]} */
  const comments = op("comments", (issue, { all = false } = {}) => (all ? [...issue.thread] : trustedComments(issue.thread)));
  const list = (name, fn) => (...args) => {
    refuse(name);
    return fn(...args);
  };
  /** CI runs are ciVerdict's and mainHealth's, whose tests fake them at `gh`. @returns {(...args: any[]) => any} */
  const noCi = (name) => () => {
    throw new Error(`fakeTracker holds no CI runs (${name})`);
  };
  return {
    claim: move("claim"),
    release: move("release"),
    park: move("park"),
    relabel,
    comment: op("comment", (issue, bodyFile) => post(issue, bodyFile, readBody(bodyFile))),
    issue: op("issue", (issue) => ({ state: issue.state, labels: [...issue.labels] })),
    read: op("read", (issue) => ({
      title: issue.title ?? "",
      body: issue.body ?? "",
      state: issue.state.toLowerCase(),
      labels: [...issue.labels].map((name) => ({ name })),
      author_association: issue.authorAssociation ?? "OWNER",
      issue_dependencies_summary: { blocked_by: issue.blocked ? 1 : 0 },
    })),
    comments,
    facts: (n) => {
      if (fail.includes("facts")) return null;
      const issue = at(n);
      const labels = [...issue.labels];
      return {
        title: issue.title ?? `issue ${n}`,
        url: `https://github.com/${REPO}/issues/${n}`,
        labels,
        size: sizeOf(labels),
        state: issue.state,
        stateReason: issue.stateReason ?? null,
        comments: comments(n),
      };
    },
    openPrFor: list("openPrFor", (branch) => {
      const open = pulls.find((p) => p.state === "OPEN" && p.headRefName === branch);
      return open ? { number: open.number, headRefOid: open.headRefOid } : null;
    }),
    prsFor: list("prsFor", ({ branch }) => (branch ? pulls.filter((p) => p.headRefName === branch) : [...pulls])),
    pr: list("pr", (n) => {
      const pr = pulls.find((p) => p.number === n);
      if (!pr) throw new Error(`HTTP 404: no pull request #${n}`);
      return pr;
    }),
    openPrs: list("openPrs", () => pulls.filter((p) => p.state === "OPEN")),
    createPr: list("createPr", ({ head }) => {
      const number = Math.max(0, ...pulls.map((p) => p.number)) + 1;
      pulls.push({ number, state: "OPEN", headRefName: head, headRefOid: null, mergedAt: null });
      return `https://github.com/${REPO}/pull/${number}`;
    }),
    openIssues: list("openIssues", () =>
      Object.keys(issues)
        .map(Number)
        .map((n) => [n, at(n)])
        .filter(([, i]) => i.state === "OPEN")
        .map(([number, i]) => ({
          number,
          title: i.title ?? `issue ${number}`,
          author_association: i.authorAssociation ?? "OWNER",
          labels: [...i.labels].map((name) => ({ name })),
          milestone: i.milestone ? { title: i.milestone } : null,
          blocked: Boolean(i.blocked),
        })),
    ),
    createIssue: list("createIssue", (o) => (writes.push(["createIssue", o]), `https://github.com/${REPO}/issues/${writes.length}`)),
    closeIssue: op("closeIssue", (issue, why) => {
      post(issue, why, why);
      issue.state = "CLOSED";
    }),
    rerunFailed: list("rerunFailed", (runId) => void writes.push(["rerunFailed", runId])),
    updateBranch: list("updateBranch", (n) => void writes.push(["updateBranch", n])),
    arm: list("arm", (n, sha) => void writes.push(["arm", n, sha])),
    disarm: list("disarm", (n) => void writes.push(["disarm", n])),
    merge: list("merge", (n, sha) => void writes.push(["merge", n, sha])),
    editPr: list("editPr", (n, bodyFile) => void writes.push(["editPr", n, bodyFile])),
    /** @type {(label: string, o?: {state?: "open"|"closed"|"all", limit?: number}) => Labelled[]} */
    labelled: list("labelled", (label, { state = "open", limit } = {}) =>
      Object.keys(issues)
        .map(Number)
        .sort((a, b) => b - a)
        .map((n) => [n, at(n)])
        .filter(([, i]) => i.labels.has(label) && (state === "all" || i.state === state.toUpperCase()))
        .slice(0, limit ?? Infinity)
        .map(([number, i]) => ({ number, title: i.title ?? `issue ${number}`, url: `https://github.com/${REPO}/issues/${number}`, state: i.state, createdAt: i.createdAt ?? "" })),
    ),
    ciRuns: noCi("ciRuns"),
    run: noCi("run"),
    runJobs: noCi("runJobs"),
    annotations: noCi("annotations"),
    treeOf: noCi("treeOf"),
    prHeadOf: noCi("prHeadOf"),
    landingView: noCi("landingView"),
    /** The writes with no issue to hold them, in order. */
    writes: () => [...writes],
    held: (n) => {
      const issue = at(n);
      return { state: issue.state, labels: [...issue.labels].sort(), comments: [...issue.comments] };
    },
    prs: () => [...pulls],
  };
}

// Rule 25 names this entry, so a session reads an issue the same way wherever gh can reach REST.
/** `--flag value` pairs, repeatable flags gathered: what the CLI below reads. */
export function flagsOf(args) {
  /** @type {Record<string, string[]>} */
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const m = /^--([\w-]+)$/.exec(args[i]);
    if (m && i + 1 < args.length) (out[m[1]] ??= []).push(args[++i]);
    else out._.push(args[i]);
  }
  return out;
}

const USAGE = `usage: node tools/loop/tracker.mjs <verb> …
  read <n>                                       rule 25: title, body, trusted comments
  comment <n> --body-file <file>
  label <n> [--add <label>]… [--remove <label>]…
  create --title <title> --body-file <file> [--label <label>]…   prints the issue's URL
  close <n> [--comment <why>]                    closed as completed
  list [--label <label>] [--state open|closed|all]   open issues as JSON
  pr-create --head <branch> --title <title> --body-file <file>  prints the pull request's URL
  pr-edit <pr> --body-file <file>`;

/**
 * The tracker as a session's commands: every write a session makes on an issue or pull request,
 * over REST. `gh issue` and `gh pr` are GraphQL, which a Claude Code cloud session is refused.
 */
export function runCli(argv, tracker = ghTracker(), say = console.log) {
  const [verb, ...rest] = argv;
  const f = flagsOf(rest);
  const n = Number(f._[0]);
  const one = (name) => f[name]?.[0];
  const need = (...names) => {
    for (const name of names) if (!one(name)) throw new Error(`${verb} needs --${name}\n${USAGE}`);
  };
  const numbered = () => {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${verb} needs an issue or pull request number\n${USAGE}`);
  };
  switch (verb) {
    case "read":
      numbered();
      return say(issueText(n, tracker));
    case "comment":
      numbered();
      need("body-file");
      return tracker.comment(n, one("body-file"));
    case "label":
      numbered();
      return tracker.relabel(n, { add: f.add ?? [], remove: f.remove ?? [] });
    case "create":
      need("title", "body-file");
      return say(tracker.createIssue({ title: one("title"), bodyFile: one("body-file"), labels: f.label ?? [] }));
    case "close":
      numbered();
      return tracker.closeIssue(n, one("comment"));
    case "list": {
      const state = /** @type {"open"|"closed"|"all"} */ (one("state") ?? "open");
      const rows = one("label") ? tracker.labelled(one("label"), { state }) : tracker.openIssues();
      return say(JSON.stringify(rows.map((i) => ({ number: i.number, title: i.title, ...("labels" in i ? { labels: i.labels.map((l) => l.name) } : {}) }))));
    }
    case "pr-create":
      need("head", "title", "body-file");
      return say(tracker.createPr({ head: one("head"), title: one("title"), bodyFile: one("body-file") }));
    case "pr-edit":
      numbered();
      need("body-file");
      return tracker.editPr(n, one("body-file"));
    default:
      throw new Error(USAGE);
  }
}

/** The tracker's half of a park, each a step a later pass can apply again on its own. */
export const PARK_STEPS = {
  label: (number, tracker) => tracker.park(number),
  comment: (number, tracker) => tracker.comment(number, parkNotePath(number)),
};

/**
 * The park steps that failed, applied again from what the park left on disk — only while the park
 * still stands. `why` says why a debt closed without being applied; `failed` is what is still owed.
 *
 * @param {number} number @param {string[]} steps
 * @returns {{failed: string[], why: string|null}}
 */
export function repark(number, steps, tracker = ghTracker(), exists = noted) {
  let issue;
  try {
    issue = tracker.issue(number, { timeout: CI_RED_TIMEOUT_MS });
  } catch (err) {
    console.error(`  ⚠️ park #${number}: the issue could not be read — ${String(err.message).split("\n")[0]}`);
    return { failed: steps, why: null };
  }
  // The label step owed leaves `in-progress` on; once it landed, `ready-for-human` is the park's own.
  // Anything else is the owner's doing, which a retry must not undo.
  const mark = steps.includes("label") ? "in-progress" : "ready-for-human";
  if (issue.state !== "OPEN" || !issue.labels.includes(mark)) {
    return { failed: [], why: "the owner already acted on the issue" };
  }
  const pruned = steps.includes("comment") && !exists(parkNotePath(number));
  const failed = steps.filter((s) => {
    if (s === "comment" && pruned) return false;
    try {
      PARK_STEPS[s](number, tracker);
      return false;
    } catch (err) {
      console.error(`  ⚠️ park #${number}: ${s} failed again — ${String(err.message).split("\n")[0]}`);
      return true;
    }
  });
  return { failed, why: pruned ? "the park note was pruned, so its comment is not posted" : null };
}

/**
 * Pushes the head review is about to read, and opens its pull request when none is open,
 * so CI runs while the review does. Not a gate: phase D's land step pushes again if this failed.
 */
export function publishForReview(number, branch, cwd, title, run = viaCli, tracker = ghTracker()) {
  const opts = { timeout: REFRESH_TIMEOUT_MS };
  run("git", ["-C", cwd, "push", "--quiet", "-u", "origin", branch], opts);
  const open = tracker.openPrFor(branch, opts);
  if (open) return prUrl(open.number);
  const body = `Closes #${number}\n\nOpened when review started. Phase D writes this description on LAND.`;
  return tracker.createPr({ head: branch, title, body }, opts);
}

export const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

/** The CONFLICT comment that routes the next pass to the rebase round. Throws when it is not posted. */
export function postConflict(number, head, tracker = ghTracker()) {
  writeNote(conflictNotePath(number), `CONFLICT ${head}\nThe branch conflicts with main: the next process rebases it onto origin/main.`);
  tracker.comment(number, conflictNotePath(number));
}

/**
 * The pull request this ticket pushed, if it pushed one.
 *
 * Falls back to the ticket number when the branch is unknown.
 *
 * `--state all`, because a pull request merged between the session's exit and this read — a peer,
 * an auto-merge, the owner — is a landing, not a session that pushed nothing. The head ref comes
 * back too: `ciVerdict` is asked for a branch's run, not a pull request's.
 *
 * `declared` is the number the session stated on its way out, asked for directly when the listing
 * has not caught up or does not reach back far enough.
 *
 * `since` bounds what counts as merged. A ticket re-opened and re-queued still has its old
 * `agent/<n>-…` pull request on the tracker, and reading that as a landing releases the claim on a
 * session that pushed nothing.
 *
 * @param {string|null} branch
 * @param {number} ticket
 * @param {number|null} [declared]
 * @param {number} [since] epoch ms; a merge older than this is not this session's
 * @param {ReturnType<typeof ghTracker>} [tracker]
 * @returns {{number: number, state: string, head: string, sha: string|null, changedFiles: number|null}|null}
 */
export function pushedPr(branch, ticket, declared = null, since = 0, tracker = ghTracker()) {
  // Matched on the head ref rather than by search: `#42` in a body also matches PR #942. With a
  // branch in hand the listing is exact; without one the newest 100 are scanned, which reaches back
  // far enough for a branch pushed minutes ago.
  // The head ref is the only thing that makes a pull request this ticket's, and it is checked on
  // every path including the declared one. `declared` is a number a model wrote, and what it
  // reaches is `gh pr merge`.
  const mine = (pr) =>
    branch ? pr?.headRefName === branch : new RegExp(`^agent/${ticket}-`).test(pr?.headRefName ?? "");
  const stale = (pr) =>
    pr.state === "MERGED" && since > 0 && Date.parse(pr.mergedAt ?? "") < since;
  const take = (pr) =>
    pr && mine(pr) && !stale(pr)
      ? { number: pr.number, state: pr.state, head: pr.headRefName, sha: pr.headRefOid ?? null, changedFiles: pr.changedFiles ?? null }
      : null;
  // A listing carries no file count; only the pull request itself does, and an unread one is unknown, not none.
  const counted = (pr) => {
    try {
      return { ...pr, changedFiles: tracker.pr(pr.number).changedFiles ?? null };
    } catch {
      return { ...pr, changedFiles: null };
    }
  };
  try {
    const rows = tracker.prsFor({ branch, ticket }).filter((pr) => mine(pr) && !stale(pr));
    const row = rows.find((p) => p.state === "OPEN") ?? rows.find((p) => p.state === "MERGED") ?? rows[0];
    const found = row && take(counted(row));
    if (found) return found;
  } catch {
    /* falls through to the declared number */
  }
  if (!declared) return null;
  try {
    return take(tracker.pr(declared));
  } catch {
    return null;
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (err) {
    console.error(String(err?.stderr?.trim() || err?.message || err));
    process.exit(2);
  }
}
