/**
 * PreToolUse guard for Bash. Reads the tool call on stdin, blocks a command only when a correct
 * alternative always exists, and says what to run instead.
 *
 * Blocked:
 *   git add -A / . / --all   sessions share an index; a bare add absorbs another session's work
 *   git checkout -- / restore  reverts to HEAD, discarding uncommitted work in the same file
 *   find / …                 a filesystem sweep; resolve packages with require.resolve instead
 *
 * Registered for both Bash and PowerShell in .claude/settings.json: the same `git` runs from
 * either, so guarding one shell only moves the mistake to the other.
 *
 * Exit 0 allows. Exit 2 blocks and returns the message on stderr to the agent.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// A command actually runs only at the start of the line or after a separator. Without this the
// guard fires on the same text quoted inside an argument — a grep pattern, a heredoc, a message —
// and blocks work that runs nothing.
const AT_COMMAND_START = String.raw`(?:^|[;&|]\s*|\$\(\s*|^\s*)`;

/**
 * Blanks the bodies of here-strings and heredocs before any rule reads the command.
 *
 * Their content is data — a commit message, a PR body, a doc — and a line inside one begins at
 * a line start like any other, so a rule anchored there fires on prose *about* a command. The
 * guard blocked the very commit that introduced it, whose message quotes the two commands it
 * refuses. Blanked rather than deleted so nothing on either side is joined into a new match.
 */
function withoutQuotedBodies(command) {
  return command
    .replace(/@(['"])[\s\S]*?\1@/g, (m) => " ".repeat(m.length)) // PowerShell @'…'@ / @"…"@
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?^\t*\2$/gm, (m) => " ".repeat(m.length)); // sh <<EOF
}

/**
 * Whether `gh run rerun <id>` would re-dispatch a device run.
 *
 * The command names a run, never a workflow, so nothing on the line says whether it costs
 * twenty-five minutes on a simulator or four on a browser shard. Both device workflows are
 * named for Maestro and a new one will be, so the answer is in the name once something asks.
 *
 * A resolver that cannot answer means no: `gh` is how the rerun would be dispatched too, so
 * blocking on its silence forbids the honest path and protects nothing.
 */
const DEVICE_WORKFLOW = /maestro/i;

function rerunsADeviceRun(command, workflowOfRun) {
  const rerun = new RegExp(AT_COMMAND_START + String.raw`gh\s+run\s+rerun\b([^|;&]*)`, "m").exec(
    command
  );
  if (!rerun) return false;
  const runId = /\b(\d{5,})\b/.exec(rerun[1]);
  return runId ? DEVICE_WORKFLOW.test(workflowOfRun(runId[1]) ?? "") : false;
}

/** The workflow a run belongs to, or null when `gh` cannot say. */
function askGitHub(runId) {
  try {
    return (
      execFileSync("gh", ["run", "view", runId, "--json", "workflowName", "-q", ".workflowName"], {
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

const RULES = [
  {
    // `git add -A`, `git add .`, `git add --all`. `-A` stages everything even after a `--`, so it
    // is blocked regardless; a bare `.` after `--` is a real pathspec and is left alone.
    test: (c) =>
      new RegExp(AT_COMMAND_START + String.raw`git\s+add\b[^|;&]*(\s-A\b|\s--all\b)`, "m").test(c) ||
      new RegExp(AT_COMMAND_START + String.raw`git\s+add\b(?![^|;&]*\s--\s)[^|;&]*\s\.(\s|$)`, "m").test(c),
    message:
      "git add -A/./--all is blocked: this checkout is shared, and a bare add stages another " +
      "session's in-flight edits into your commit. Stage by pathspec instead:\n" +
      "  git add -- path/to/file another/file\n" +
      "Check what you are about to stage with `git status --short` first.",
  },
  {
    // `git checkout -- <paths>` and `git restore <paths>` discard the working tree. Both are
    // allowed once a source is named (`git checkout HEAD -- x`, `git restore --source=x`):
    // that form is only ever reached deliberately, and it is the documented way back once the
    // work being protected is committed.
    // `--staged` alone only unstages; it is `--worktree` (the default) that discards edits.
    test: (c) =>
      new RegExp(AT_COMMAND_START + String.raw`git\s+checkout\s+--\s`, "m").test(c) ||
      new RegExp(
        AT_COMMAND_START +
          String.raw`git\s+restore\s+(?![^|;&]*(--source|--staged(?![^|;&]*--worktree)))[^|;&]*\S`,
        "m"
      ).test(c),
    message:
      "git checkout -- / git restore is blocked: it reverts the file to HEAD and throws away " +
      "every uncommitted change in it — including a fix you have not committed yet. This has " +
      "cost real work four times.\n" +
      "Undoing a seeded defect? Reverse it with the Edit tool — the same replacement backwards.\n" +
      "Really want the file back from a commit? Commit your work first, then name the source:\n" +
      "  git checkout HEAD -- path/to/file\n" +
      "Confirm with `git status --short` and `git diff` afterwards.",
  },
  {
    // Measured, not theorised: `git worktree remove --force` on a worktree whose node_modules
    // is a junction deletes through it into the target and exits 0, silently. That is how the
    // shared install came to be empty. `worktrees:remove` detaches the link first.
    test: (c) =>
      new RegExp(
        AT_COMMAND_START + String.raw`git\s+worktree\s+remove\b[^|;&]*(\s--force\b|\s-f\b)`,
        "m"
      ).test(c),
    message:
      "git worktree remove --force is blocked: if the worktree's node_modules is a junction, " +
      "it deletes through the link into the shared install and still exits 0. That is how " +
      "C:\\Users\\roton\\murlan\\node_modules was emptied.\n" +
      "Use the script that detaches the link first:\n" +
      "  npm run worktrees:remove -- .worktrees/<name>\n" +
      "Better still, do not create the junction: a worktree nested inside the checkout already " +
      "resolves up to the parent's node_modules on its own.",
  },
  {
    // A device run costs ~25 minutes and its artefact already holds the answer to the next
    // one. Run 33428373840 was spent discovering a screen the previous run's screenshot had
    // captured: the flow gated its opening move on the 3 of Spades, the deal held the 3 of
    // Hearts, and every later tap went into a button that cannot enable until someone opens.
    // Reading the artefact is the rule; this is the only thing that has ever made it happen.
    test: (c, workflowOfRun) =>
      !/MAESTRO_EVIDENCE_READ=1/.test(c) &&
      (new RegExp(
        AT_COMMAND_START + String.raw`gh\s+workflow\s+run\s+\S*(ios|maestro)\b`,
        "m"
      ).test(c) ||
        rerunsADeviceRun(c, workflowOfRun)),
    message:
      "Dispatching a device run is blocked until you have read the last failure's own pixels.\n" +
      "A run is ~25 minutes; the artefact is already on disk and usually holds the answer.\n" +
      "  gh run download <failed-run-id> -n maestro-debug-ios -D <scratchpad>/<run-id>\n" +
      "Then, before forming any hypothesis:\n" +
      "  - Read the screenshot under */screenshots/ with the Read tool. Look at it.\n" +
      "  - Dump the labelled nodes from */screen-hierarchy/*.json and check your selectors\n" +
      "    against the real text, including index: and regex matches.\n" +
      "Having actually done that, re-run the same command with the marker:\n" +
      "  MAESTRO_EVIDENCE_READ=1 <your command>\n" +
      "The marker is a claim that you looked. Do not set it to get past this message.",
  },
  {
    // A sweep rooted at /, a mounted drive root (/c/, /mnt/c/) or a Windows drive root.
    test: (c) =>
      new RegExp(
        AT_COMMAND_START + String.raw`find\s+(\/(\s|$)|\/(mnt\/)?[a-z]\/(\s|$)|[A-Za-z]:[\\/](\s|$))`,
        "m"
      ).test(c),
    message:
      "A filesystem-wide `find` is blocked: it takes minutes and finds nothing useful here. " +
      "To locate an installed package, ask Node:\n" +
      '  node -e "console.log(require.resolve(\'<package>\'))"\n' +
      "The install directory is `dirname \"$(git rev-parse --path-format=absolute --git-common-dir)\"`. " +
      "To search the repo, use the Grep tool.",
  },
];

export function check(command, workflowOfRun = askGitHub) {
  const runnable = withoutQuotedBodies(command);
  for (const rule of RULES) if (rule.test(runnable, workflowOfRun)) return rule.message;
  return null;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let command = "";
  try {
    const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
    command = (payload.tool_input ?? payload).command ?? "";
  } catch {
    process.exit(0); // unreadable payload must never block a tool call
  }
  const message = check(command);
  if (message) {
    process.stderr.write(message + "\n");
    process.exit(2);
  }
}
