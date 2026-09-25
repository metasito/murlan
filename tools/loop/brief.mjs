/**
 * Every subagent brief the loop dispatches, so a session passes it on rather than rewriting it:
 * #1103's builder narrowed "callers" to "file, function or npm script" and missed an env var.
 * `guard-agent-model.mjs` denies a loop dispatch that names a kind here without this exact text.
 *
 * Usage: node tools/loop/brief.mjs <kind> <n> <worktree> [base]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const KINDS = ["scope", "completeness", "standards", "spec", "refute", "fix"];

const HEADER_RE = /^BRIEF (\w+) #(\d+) (\S+) (\S+)$/;

const BASELINE = join(import.meta.dirname, "..", "..", "docs", "agents", "smell-baseline.md");

/** Never throws: a brief that cannot be built is one the guard cannot compare against, and passes. */
function baseline() {
  try {
    return readFileSync(BASELINE, "utf8").trim();
  } catch {
    return "(docs/agents/smell-baseline.md is missing: review against RULES.md alone.)";
  }
}

const TAIL =
  "Do not spawn any subagent. Report findings only — what checked out is not reported. Every " +
  "finding names a file:line and either the rule number it breaks, a quoted line of the issue, or " +
  "the input that makes it go wrong. A finding carrying none of those three is a note, and notes " +
  "are not reported.";

const diff = (wt, base) => `\`git -C ${wt} diff ${base}...HEAD\``;
const issue = (n) =>
  `\`gh issue view ${n} --json title,body,comments --jq '.title, .body, (.comments[]|"--- "+.author.login+": "+.body)'\``;

const BODIES = {
  scope: ({ n, worktree }) =>
    `Investigate issue #${n} (${issue(n)}) in the worktree \`${worktree}\`. Report: every place ` +
    "the change has to touch as `path:start-end — what that range does`, never a bare file name; " +
    "existing patterns worth reusing, the same way; the risks; and whether the ticket makes sense " +
    "at all. If it is ambiguous, its premise is wrong, or the codebase already does it, say so " +
    "plainly. Then list the ticket's independent feature groups: sets of Definition-of-done boxes " +
    "that share no file and no behaviour with any other set, each as its box texts. Do not run " +
    "`npm run agent:check`.",
  completeness: ({ n, worktree, base }) =>
    `Read issue #${n} with ${issue(n)} (a later comment overrides the body) and the change with ` +
    `${diff(worktree, base)}. For each Definition-of-done box, answer done, partial or missing. ` +
    "Done names the `<path>:<line>` that does it and the test that fails when that line is deleted " +
    "— a test that passes either way does not count; a pure deletion or a docs change says " +
    "\"no test applicable\". Then list what the issue asks for that no box covers, and every " +
    "caller of a changed function the diff did not update. Then list every name the diff removes " +
    "or renames — identifier, export, env var, file path, npm script, locale key, testID, CLI " +
    `flag, workflow or job name — run \`git -C ${worktree} grep -n -F <name>\` for each, and ` +
    "report every remaining mention outside the diff's own deleted lines.",
  standards: ({ worktree, base }) =>
    `Review the change ${diff(worktree, base)} against \`docs/agents/RULES.md\` (read it in the ` +
    "worktree) and the smell baseline below. Report only what affects correctness or breaks a " +
    "documented rule, by number, quoted. Skip what tooling enforces. A baseline smell alone is a " +
    "judgement call, never a hard violation.\n\n" +
    baseline(),
  spec: ({ n, worktree, base }) =>
    `Review the change ${diff(worktree, base)} against issue #${n} (${issue(n)}, body and ` +
    "comments; a later comment overrides the body). Report requirements missing or partial, " +
    "behaviour not asked for, and anything implemented but wrong, quoting the issue.",
  refute: ({ worktree, base }) =>
    `The change is ${diff(worktree, base)}. For each finding below, try to kill it. A finding ` +
    "survives only if you can state the input or the sequence that makes the code wrong, or quote " +
    "the rule or the issue line it breaks. Answer with the surviving findings and one sentence " +
    "each on what killed the rest. Do not review the change for anything the reports did not raise.",
  fix: ({ n, worktree, base }) =>
    `A CI fix round on issue #${n}. The fix is ${diff(worktree, base)}; the failure it answers is ` +
    `the newest \`CI-RED\` comment in ${issue(n)}. Review it on two axes, reported under ` +
    "`## Standards` and `## Spec`: Standards against `docs/agents/RULES.md`, only what affects " +
    "correctness or breaks a rule by number; Spec against the issue and the CI-RED — does the fix " +
    "answer every failing test it names, without changing what the ticket asked for.",
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

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [kind, n, worktree, base] = process.argv.slice(2);
  if (!KINDS.includes(kind) || !/^\d+$/.test(n ?? "") || !worktree) {
    process.stderr.write(`usage: node tools/loop/brief.mjs <${KINDS.join("|")}> <n> <worktree> [base]\n`);
    process.exit(2);
  }
  process.stdout.write(brief(kind, { n: Number(n), worktree, base }));
}
