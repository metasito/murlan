/**
 * The prompt of every `loop-<kind>` dispatch: the header `reviewerRan` binds a reviewer to its
 * ticket by, and the commands that read the ticket and its change. What each kind does with them is
 * its `.claude/agents/loop-<kind>.md`.
 *
 * Usage: node tools/loop/brief.mjs <kind> <n> <worktree> [base]
 */
import { git as gitAt, statusOf } from "./cli.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { dodCheckFor, ticketComments, WORKTREE_DIR } from "./loop-derive.mjs";
import { readIssue, TRUSTED_SELECT } from "./tracker.mjs";

export const KINDS = ["scope", "completeness", "review", "fix"];

/** Rule 29's model for each kind, which its `.claude/agents/loop-<kind>.md` names. */
export const MODEL_BY_KIND = { scope: "sonnet", completeness: "sonnet", review: "opus", fix: "opus" };

const HEADER_RE = /^BRIEF (\w+) #(\d+) (\S+) (\S+)$/;

/**
 * A later round's delta, net of the main a merge brought in: `base` merged with that main, diffed
 * to HEAD, leaves only the fix and the merge's own resolution. It reads the worktree, so
 * guard-agent-model.mjs's rebuild of a brief matches the CLI's only while HEAD has not moved between the two.
 */
function laterDelta(wt, base) {
  const git = (...args) => {
    try {
      return gitAt(wt).text(args);
    } catch {
      return null;
    }
  };
  const newest = git("rev-list", "--first-parent", "--merges", "-n", "1", `${base}..HEAD`);
  if (!newest) return `\`git -C ${wt} diff ${base}..HEAD\``;
  const main = git("rev-parse", "--verify", "-q", `${newest}^2`);
  const merged = main ? git("merge-tree", "--write-tree", base, main) : null;
  if (merged) return `\`git -C ${wt} diff ${merged.split("\n")[0]} HEAD\``;
  return (
    `\`git -C ${wt} diff ${base}..HEAD\`, with ` +
    `\`git -C ${wt} log -p --first-parent --diff-merges=remerge --merges ${base}..HEAD\` for a merge's own ` +
    "edits (what a merge brought in from main is not the fix)"
  );
}

const rebasedFrom = (wt, base) => statusOf(() => gitAt(wt)(["merge-base", "--is-ancestor", base, "HEAD"])) === 1;

/** A base a rebase moved the branch from: a plain delta would carry the whole ticket and main, a range-diff only the resolution. */
const diff = (wt, base) =>
  base === "origin/main"
    ? `\`git -C ${wt} diff ${base}...HEAD\``
    : rebasedFrom(wt, base)
      ? `\`git -C ${wt} range-diff ${base}...HEAD\``
      : laterDelta(wt, base);
const issue = (n) => `\`${readIssue(n)}\``;

const ASKS_COMMENTS = /(^|\s)(--comments|-c)(\s|$)|--json[\s=]\S*\b(comments|reviews|latestReviews|timeline)\b/;
const API_BODY = /^(-f|-F|--field|--raw-field|--input)$|^--(raw-)?field=/;
const API_THREAD = /(?:^|\/)(?:issues|pulls)\/(?:\d+\/)?(?:comments|reviews|timeline)(?:[/?]|$)/;

/** The method a `gh api` call sends: its `-X`/`--method`, else POST once it carries a field or input, as gh does. */
export function apiMethod(args) {
  const at = args.findIndex((a) => a === "-X" || a === "--method");
  const joined = args.find((a) => /^-X.|^--method=/.test(a))?.replace(/^-X|^--method=/, "");
  const named = at >= 0 ? args[at + 1] : joined;
  return (named || (args.some((a) => API_BODY.test(a)) ? "POST" : "GET")).toUpperCase();
}

/** `gh`'s arguments, verb first, read an issue's or pull request's thread or reviews. */
/** Rule 25's read, which keeps only trusted authors' comments in code rather than in a jq string. */
const rule25Read = (args) => args[0] === "tracker.mjs" && args[1] === "read";
export const readsComments = (args) =>
  rule25Read(args) ||
  (/^(issue|pr)$/.test(args[0] ?? "") && args[1] === "view" && ASKS_COMMENTS.test(args.slice(2).join(" "))) ||
  (args[0] === "api" && (args.includes("graphql") || (apiMethod(args) === "GET" && args.some((a) => API_THREAD.test(a)))));
/** The jq programs a `gh` call runs: the value of `--jq`/`-q`, and nothing else it merely carries. */
const jqPrograms = (args) =>
  args.flatMap((a, i) => (/^(--jq|-q)$/.test(a) ? [args[i + 1] ?? ""] : [/^--jq=([\s\S]*)$/.exec(a)?.[1] ?? /^-q([\s\S]+)$/.exec(a)?.[1]].filter((v) => v !== undefined)));
/** The top-level `|` stages of a jq program, or null when a bracket or string does not close. */
function stagesOf(program) {
  const stages = [];
  let depth = 0;
  let quoted = false;
  let from = 0;
  for (let i = 0; i < program.length; i++) {
    const ch = program[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "|" && depth === 0) {
      stages.push(program.slice(from, i).trim());
      from = i + 1;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0 || quoted) return null;
  return [...stages, program.slice(from).trim()];
}

const PATH_STAGE = /^\.[\w.\[\]?]*$/;

/**
 * Whether a jq program passes through only trusted authors: exactly one stage is the canonical select, every
 * stage before it only walks to an array (`.comments[]`), and none produces a second output.
 */
export const keepsTrusted = (program) => {
  // A document's `gh` line is split on spaces, not by a shell, so its program still wears its quotes.
  const stages = stagesOf(program.replace(/^'([\s\S]*)'$/, (_, inner) => inner));
  if (!stages) return false;
  const at = stages.indexOf(TRUSTED_SELECT);
  return at >= 0 && stages.indexOf(TRUSTED_SELECT, at + 1) < 0 && stages.slice(0, at).every((s) => PATH_STAGE.test(s)) && stages.slice(at + 1).every((s) => PATH_STAGE.test(s));
};

/** A thread read without rule 25's filter, where an outsider's `DOD-CHECK` or `REVIEW` reads as the loop's own. GraphQL's shape has no filter that keeps it. */
export const untrustedRead = (args) =>
  readsComments(args) && !rule25Read(args) && (args.includes("graphql") || !(jqPrograms(args).length > 0 && jqPrograms(args).every(keepsTrusted)));
/** A thread fetched by an HTTP client, which no jq filter of `gh` reaches. */
export const fetchesThread = (cmd, args) =>
  /^(curl|wget|invoke-restmethod|invoke-webrequest|irm|iwr)$/.test(cmd) && args.some((a) => API_THREAD.test(a));
/**
 * Each thread read a document gives: `gh`'s arguments, or `tracker.mjs read <n>` for rule 25's. A
 * `\` continuation joins its lines.
 */
export const commentReads = (text) =>
  text
    .replace(/\\\r?\n\s*/g, " ")
    .split("\n")
    .flatMap((line) => {
      const rule25 = /\btools\/loop\/(tracker\.mjs) (read) (\S+?)`?(?:\s|$)/.exec(line);
      const at = line.search(/\bgh ((issue|pr) view|api)\b/);
      return [...(rule25 ? [rule25.slice(1)] : []), ...(at < 0 ? [] : [line.slice(at + 3).split(/[\s`]+/).filter(Boolean)])];
    })
    .filter(readsComments);

/** @param {string} kind @param {{n: number, worktree: string, base?: string}} opts */
export function brief(kind, { n, worktree, base = "origin/main" }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown brief kind: ${kind} (one of ${KINDS.join(", ")})`);
  const change = kind === "scope" ? "" : `Change: ${diff(worktree, base)}\n`;
  return `BRIEF ${kind} #${n} ${worktree} ${base}\n\nIssue: ${issue(n)}\n${change}`;
}

/** @param {string} prompt */
export function parseHeader(prompt) {
  const m = HEADER_RE.exec(String(prompt ?? "").split("\n")[0]);
  return m && KINDS.includes(m[1]) ? { kind: m[1], n: Number(m[2]), worktree: m[3], base: m[4] } : null;
}

/** Why the delta cannot be read from these arguments, or null when it can. */
function unreadable(n, worktree, base) {
  if (!new RegExp(`(^|/)\\${WORKTREE_DIR}/agent-${n}$`).test(worktree.replace(/\\/g, "/").replace(/\/+$/, ""))) {
    return `the worktree must be ${WORKTREE_DIR}/agent-${n}, not ${worktree}`;
  }
  if (base && base !== "origin/main") {
    if (statusOf(() => gitAt(worktree)(["rev-parse", "--verify", "-q", `${base}^{commit}`])) !== 0) {
      return `${base} is not a commit in ${worktree}`;
    }
  }
  return null;
}

/** This head's `n/a` boxes, which follow a review brief, or why they cannot be read. */
function naBoxes(n, worktree) {
  const comments = ticketComments(n);
  if (!comments) return `cannot read #${n}'s DOD-CHECK from the tracker`;
  let head = null;
  try {
    head = gitAt(worktree).text(["rev-parse", "HEAD"]);
  } catch {}
  if (!head) return `cannot read HEAD in ${worktree}`;
  const na = dodCheckFor(comments, head, () => false)?.na ?? [];
  return { text: `\nDefinition-of-done boxes ticked n/a at ${head.slice(0, 7)}:\n${na.join("\n") || "none"}\n` };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [kind, n, worktree, base] = process.argv.slice(2);
  if (!KINDS.includes(kind) || !/^\d+$/.test(n ?? "") || !worktree) {
    process.stderr.write(`usage: node tools/loop/brief.mjs <${KINDS.join("|")}> <n> <worktree> [base]\n`);
    process.exit(2);
  }
  const listed = unreadable(n, worktree, base) ?? (kind === "review" ? naBoxes(Number(n), worktree) : { text: "" });
  if (typeof listed === "string") {
    process.stderr.write(`brief: ${listed}\n`);
    process.exit(2);
  }
  process.stdout.write(brief(kind, { n: Number(n), worktree, base }) + listed.text);
}
