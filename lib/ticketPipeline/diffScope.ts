// lib/ticketPipeline/diffScope.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Nine review-lens agents each re-fetching the same `git diff` cost ~10-15s apiece. Inlining it
// into the prompt instead is cheaper only up to a point: a diff big enough to blow past this many
// lines costs more pasted into three prompts than fetched by three `git diff` calls.
export const INLINE_DIFF_LINE_LIMIT = 400;

export interface DiffScope {
  inline: boolean;
  lineCount: number;
}

export function pickDiffScope(diffText: string): DiffScope {
  const trimmed = diffText.replace(/\n+$/, "");
  const lineCount = trimmed === "" ? 0 : trimmed.split("\n").length;
  return { inline: lineCount > 0 && lineCount <= INLINE_DIFF_LINE_LIMIT, lineCount };
}

// The diff arrives as raw text on stdin, not JSON: a unified diff routinely contains quotes and
// backslashes that a fallible round-trip through JSON.stringify would mangle before it got here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const diffText = readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify(pickDiffScope(diffText)));
}
