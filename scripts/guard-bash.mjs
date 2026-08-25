/**
 * PreToolUse guard for Bash. Reads the tool call on stdin, blocks a command only when a correct
 * alternative always exists, and says what to run instead.
 *
 * Blocked:
 *   git add -A / . / --all   sessions share an index; a bare add absorbs another session's work
 *   find / …                 a filesystem sweep; resolve packages with require.resolve instead
 *
 * Exit 0 allows. Exit 2 blocks and returns the message on stderr to the agent.
 */
import { readFileSync } from "node:fs";

// A command actually runs only at the start of the line or after a separator. Without this the
// guard fires on the same text quoted inside an argument — a grep pattern, a heredoc, a message —
// and blocks work that runs nothing.
const AT_COMMAND_START = String.raw`(?:^|[;&|]\s*|\$\(\s*|^\s*)`;

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

export function check(command) {
  for (const rule of RULES) if (rule.test(command)) return rule.message;
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
