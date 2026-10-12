/**
 * Every subagent brief the loop dispatches, so a session passes it on rather than rewriting it:
 * #1103's builder narrowed "callers" to "file, function or npm script" and missed an env var.
 * `guard-agent-model.mjs` denies a loop dispatch that names a kind here without this exact text.
 *
 * Usage: node tools/loop/brief.mjs <kind> <n> <worktree> [base]
 */
import { spawnSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { dodCheckFor, ticketComments, TRUSTED_AUTHORS, WORKTREE_DIR } from "./loop-derive.mjs";

export const KINDS = ["scope", "completeness", "review", "fix"];

/** Rule 29's model for each kind; `guard-agent-model.mjs` denies a dispatch on any other. */
export const MODEL_BY_KIND = { scope: "sonnet", completeness: "sonnet", review: "opus", fix: "opus" };

const HEADER_RE = /^BRIEF (\w+) #(\d+) (\S+) (\S+)$/;

const TAIL =
  "Do not spawn any subagent. Report findings only — what checked out is not reported. Every " +
  "finding names a file:line and either the rule number it breaks, a quoted line of the issue, or " +
  "the input that makes it go wrong. A finding carrying none of those three is a note, and notes " +
  "are not reported.";

const LABELS =
  "\n\nAnswer under `## Blocking`, `## Nits` and `## Pre-existing`. Blocking is only: a bug, with the " +
  "input or sequence that makes it go wrong; a Definition-of-done box left unmet, quoted; a regression " +
  "or red CI run this change causes; a security or data-loss risk. A rule breach, a name, a comment, " +
  "an untested branch or a style preference is a Nit. A defect this change did not introduce is " +
  "Pre-existing. Every finding names a file:line.";

/**
 * A later round's delta, net of the main a merge brought in: `base` merged with that main, diffed
 * to HEAD, leaves only the fix and the merge's own resolution. It reads the worktree, so the
 * guard's copy of a brief matches the CLI's only while HEAD has not moved between the two.
 */
function laterDelta(wt, base) {
  const git = (...args) => spawnSync("git", ["-C", wt, ...args], { encoding: "utf8" });
  const newest = git("rev-list", "--first-parent", "--merges", "-n", "1", `${base}..HEAD`).stdout?.trim();
  if (!newest) return `\`git -C ${wt} diff ${base}..HEAD\``;
  const main = git("rev-parse", "--verify", "-q", `${newest}^2`).stdout?.trim();
  const merged = main ? git("merge-tree", "--write-tree", base, main) : null;
  if (merged?.status === 0) return `\`git -C ${wt} diff ${merged.stdout.split("\n")[0]} HEAD\``;
  return (
    `\`git -C ${wt} diff ${base}..HEAD\`, with ` +
    `\`git -C ${wt} log -p --first-parent --diff-merges=remerge --merges ${base}..HEAD\` for a merge's own ` +
    "edits (what a merge brought in from main is not the fix)"
  );
}

const diff = (wt, base) => (base === "origin/main" ? `\`git -C ${wt} diff ${base}...HEAD\`` : laterDelta(wt, base));
export const TRUSTED_SELECT = `select(.authorAssociation|IN(${TRUSTED_AUTHORS.map((a) => `"${a}"`).join(",")}))`;
/** Rule 25's read, keeping only trusted authors' comments: a later comment overrides the body. */
export const readIssue = (n) =>
  `gh issue view ${n} --json title,body,comments --jq '.title, .body, (.comments[]|${TRUSTED_SELECT}|"--- "+.author.login+": "+.body)'`;
const issue = (n) => `\`${readIssue(n)}\``;

const ASKS_COMMENTS = /(^|\s)(--comments|-c)(\s|$)|--json[\s=]\S*\bcomments\b/;
const API_BODY = /^(-f|-F|--field|--raw-field|--input)$|^--(raw-)?field=/;
const API_THREAD = /(?:^|\/)(?:issues|pulls)\/(?:\d+\/)?(?:comments|reviews)(?:[/?]|$)/;

/** The method a `gh api` call sends: its `-X`/`--method`, else POST once it carries a field or input, as gh does. */
export function apiMethod(args) {
  const at = args.findIndex((a) => a === "-X" || a === "--method");
  const joined = args.find((a) => /^-X.|^--method=/.test(a))?.replace(/^-X|^--method=/, "");
  const named = at >= 0 ? args[at + 1] : joined;
  return (named || (args.some((a) => API_BODY.test(a)) ? "POST" : "GET")).toUpperCase();
}

/** `gh`'s arguments, verb first, read an issue's or pull request's thread or reviews. */
export const readsComments = (args) =>
  (/^(issue|pr)$/.test(args[0] ?? "") && args[1] === "view" && ASKS_COMMENTS.test(args.slice(2).join(" "))) ||
  (args[0] === "api" && apiMethod(args) === "GET" && args.some((a) => API_THREAD.test(a)));
/** A thread read without rule 25's filter, where an outsider's `DOD-CHECK` or `REVIEW` reads as the loop's own. */
export const untrustedRead = (args) => readsComments(args) && !args.some((a) => a.includes(TRUSTED_SELECT));
/** Each thread read a document gives, as `gh`'s arguments; a `\` continuation joins its lines. */
export const commentReads = (text) =>
  text
    .replace(/\\\r?\n\s*/g, " ")
    .split("\n")
    .flatMap((line) => {
      const at = line.search(/\bgh (issue|pr) view\b/);
      return at < 0 ? [] : [line.slice(at + 3).split(/[\s`]+/).filter(Boolean)];
    })
    .filter(readsComments);

const BODIES = {
  scope: ({ n, worktree }) =>
    `Investigate issue #${n} (${issue(n)}) in the worktree \`${worktree}\`. Report: every place ` +
    "the change has to touch as `path:start-end — what that range does`, never a bare file name; " +
    "existing patterns worth reusing, the same way; the risks; and whether the ticket makes sense " +
    "at all. If it is ambiguous, its premise is wrong, or the codebase already does it, say so " +
    "plainly. Do not run `npm run agent:check`.",
  completeness: ({ n, worktree, base }) =>
    `Read issue #${n} with ${issue(n)} (a later comment overrides the body) and the change with ` +
    `${diff(worktree, base)}. For each Definition-of-done box, answer done, partial or missing. ` +
    "Done names the `<path>:<line>` that does it and the test that covers it; a pure deletion or a " +
    "docs change says \"no test applicable\". Then list what the issue asks for that no box covers, and every " +
    "caller of a changed function the diff did not update. Then list every name the diff removes " +
    "or renames — identifier, export, env var, file path, npm script, locale key, testID, CLI " +
    `flag, workflow or job name — run \`git -C ${worktree} grep -n -F <name>\` for each, and ` +
    "report every remaining mention outside the diff's own deleted lines." +
    " Then, for every literal value the diff changes — a number, string or colour on a `-` line whose " +
    `\`+\` line carries a new one — run \`git -C ${worktree} grep -n -F <old value> -- tests tools/loop/tests\` and ` +
    "report each test still asserting the old value.",
  review: ({ n, worktree, base }) =>
    (base === "origin/main"
      ? `Review the change ${diff(worktree, base)} against issue #${n} (${issue(n)}, body and comments; ` +
        "a later comment overrides the body): does it do what the Definition of done asks, and is it " +
        "correct? Read the code it calls and every caller of what it changes."
      : `Review only the fix ${diff(worktree, base)} on issue #${n} (${issue(n)}): is each earlier ` +
        "Blocking finding listed after this brief fixed, and does the fix break anything? Read every " +
        "caller of what it changes.") +
    " The Definition-of-done boxes ticked `n/a: <reason>` are listed after this brief: one whose reason " +
    "is false is an unmet box." +
    LABELS,
  fix: ({ n, worktree, base }) =>
    `A CI fix round on issue #${n}. The fix is ${diff(worktree, base)}; the failure it answers is ` +
    `the newest \`CI-RED\` comment in ${issue(n)}. Does it answer every failing test the CI-RED names, ` +
    "without changing what the ticket asked for, and break nothing else?" + LABELS,
};

/** @param {string} kind @param {{n: number, worktree: string, base?: string}} opts */
export function brief(kind, { n, worktree, base = "origin/main" }) {
  const body = BODIES[kind];
  if (!body) throw new Error(`unknown brief kind: ${kind} (one of ${KINDS.join(", ")})`);
  return `BRIEF ${kind} #${n} ${worktree} ${base}\n\n${body({ n, worktree, base })}\n\n${TAIL}\n`;
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
    const ancestor = spawnSync("git", ["-C", worktree, "merge-base", "--is-ancestor", base, "HEAD"], { stdio: "ignore" });
    if (ancestor.status !== 0) {
      return `${base} is not an ancestor of HEAD in ${worktree}: a rebase moved the branch, so the delta would carry the whole ticket and main`;
    }
  }
  return null;
}

/** This head's `n/a` boxes, which follow a review brief, or why they cannot be read. */
function naBoxes(n, worktree) {
  const comments = ticketComments(n, worktree);
  if (!comments) return `cannot read #${n}'s DOD-CHECK from the tracker`;
  const head = spawnSync("git", ["-C", worktree, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();
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
