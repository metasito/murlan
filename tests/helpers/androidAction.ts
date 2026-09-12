// The Maestro Android action, as the two things a test can ask about it: the
// commands its script actually runs, and the `with:` block that configures the
// emulator. Shared because a second copy is how one of them ends up weaker than
// the other — a scan over the raw file text is satisfied by a commented-out
// command, which is the one failure a test about a CI script must not have.
import { readFileSync } from "node:fs";
import path from "node:path";

const ACTION = ".github/actions/drive-android-flows/action.yml";

function readAction(repoRoot: string): string {
  return readFileSync(path.join(repoRoot, ACTION), "utf8");
}

/**
 * The action's `script:` block, comments and blank lines dropped, one trimmed
 * command per entry. Dropping `#` lines is the point: what the script *runs* is
 * the only thing any claim here is about.
 */
export function actionScriptLines(repoRoot: string): string[] {
  const src = readAction(repoRoot);
  const start = src.indexOf("script: |");
  if (start === -1) throw new Error("the action no longer carries a script block");
  return src
    .slice(start)
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

/**
 * The action's `with:` block — what configures the emulator, as opposed to what
 * the script runs on it. Sliced from `with:` rather than from the top of the
 * file: `description:` above it is folded prose, and a line in an English
 * sentence can look enough like `profile: something` to answer for one.
 */
export function actionConfigLines(repoRoot: string): string[] {
  const src = readAction(repoRoot);
  const start = src.indexOf("with:");
  const end = src.indexOf("script: |");
  if (start === -1 || end === -1 || start > end) {
    throw new Error("the action no longer carries a `with:` block above its script");
  }
  return src
    .slice(start, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}
