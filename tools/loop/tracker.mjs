/**
 * GitHub, for the loop: every issue and pull request it reads or moves, and who it trusts, behind
 * one interface — `ghTracker` over `gh api`, `fakeTracker` in memory. The label set is
 * `docs/agents/issue-tracker.md`'s.
 *
 * REST only: `gh issue` and `gh pr` go through GraphQL, which a Claude Code cloud session is refused.
 */
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { gh as ghCli, REPO } from "./cli.mjs";

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
const notFound = (err) => /HTTP 404/.test(String(err?.stderr ?? "") + String(err?.message ?? ""));

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

/** @typedef {(args: string[], opts?: import("./cli.mjs").RunOptions) => string} Gh */
/** @param {Gh} [gh] */
export function ghTracker(gh = ghCli) {
  const issues = `repos/${REPO}/issues`;
  const pulls = `repos/${REPO}/pulls`;
  const get = (path, opts) => JSON.parse(gh(["api", path], opts));
  // `--slurp` wraps each page, so a listing past one page is read whole rather than cut at its first.
  const all = (path, opts) => JSON.parse(gh(["api", "--paginate", "--slurp", path], opts)).flat();
  const headOf = (branch) => encodeURIComponent(`${REPO.split("/")[0]}:${branch}`);

  const move = (name) => (n) => {
    const [remove, add] = TRANSITIONS[name];
    if (add.length) gh(["api", "-X", "POST", `${issues}/${n}/labels`, ...add.flatMap((l) => ["-f", `labels[]=${l}`])]);
    for (const l of remove) {
      try {
        gh(["api", "-X", "DELETE", `${issues}/${n}/labels/${encodeURIComponent(l)}`]);
      } catch (err) {
        if (!notFound(err)) throw err;
      }
    }
  };
  /** @type {(n: number, opts?: {all?: boolean} & import("./cli.mjs").RunOptions) => Comment[]} */
  const comments = (n, { all: everyone = false, ...opts } = {}) => {
    const got = all(`${issues}/${n}/comments?per_page=100`, opts).map(commentOf);
    return everyone ? got : trustedComments(got);
  };

  return {
    claim: move("claim"),
    release: move("release"),
    park: move("park"),
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
    createPr: ({ head, title, body }, opts) =>
      JSON.parse(gh(["api", "-X", "POST", pulls, "-f", "base=main", "-f", `head=${head}`, "-f", `title=${title}`, "-f", `body=${body}`], opts)).html_url,
    /** Issues only: REST lists pull requests among them. */
    openLabelled: (label, opts) =>
      all(`${issues}?state=open&labels=${encodeURIComponent(label)}&per_page=100`, opts)
        .filter((i) => !i.pull_request)
        .map((i) => ({ number: i.number, title: i.title, createdAt: i.created_at })),
    /** @returns {OpenIssue[]} */
    openIssues: (opts) => all(`${issues}?state=open&per_page=100`, opts).filter((i) => !i.pull_request).map(openIssueOf),
  };
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
  const move = (name) =>
    op(name, (issue) => {
      const [remove, add] = TRANSITIONS[name];
      for (const l of remove) issue.labels.delete(l);
      for (const l of add) issue.labels.add(l);
    });
  const pulls = [...prs];
  /** @type {(n: number, opts?: {all?: boolean}) => Comment[]} */
  const comments = op("comments", (issue, { all = false } = {}) => (all ? [...issue.thread] : trustedComments(issue.thread)));
  const list = (name, fn) => (...args) => {
    refuse(name);
    return fn(...args);
  };
  return {
    claim: move("claim"),
    release: move("release"),
    park: move("park"),
    comment: op("comment", (issue, bodyFile) => void issue.comments.push(bodyFile)),
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
    openLabelled: list("openLabelled", (label) =>
      Object.keys(issues)
        .map(Number)
        .map((n) => [n, at(n)])
        .filter(([, i]) => i.state === "OPEN" && i.labels.has(label))
        .map(([number, i]) => ({ number, title: i.title ?? `issue ${number}`, createdAt: i.createdAt ?? "" })),
    ),
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
    held: (n) => {
      const issue = at(n);
      return { state: issue.state, labels: [...issue.labels].sort(), comments: [...issue.comments] };
    },
    prs: () => [...pulls],
  };
}

// Rule 25 names this entry, so a session reads an issue the same way wherever gh can reach REST.
if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [verb, n] = process.argv.slice(2);
  if (verb !== "read" || !/^\d+$/.test(n ?? "")) {
    console.error("usage: node tools/loop/tracker.mjs read <n>");
    process.exit(2);
  }
  console.log(issueText(Number(n)));
}
