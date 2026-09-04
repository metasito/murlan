// lib/ticketPipeline/worktree.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { shellQuote } from "./shell.ts";

export interface WorktreeRequest {
  number: number;
  branch: string;
}

// Inside the checkout, not beside it. Node resolves both a bare `import` and `require.resolve` by
// walking *ancestor* directories only, so a worktree nested here finds the main checkout's
// `node_modules` on its own — a sibling (`../murlan-wt-N`) finds nothing, and every script and
// test in it dies on its first import (#275). Linking an install into a sibling instead is what
// let `git worktree remove --force` delete through the link and empty the real node_modules.
//
// `.gitignore`, `tsconfig.json`'s exclude and `eslint.config.js`'s ignores all name this
// directory: nested means the repo's own tooling would otherwise walk a second copy of the tree.
export const WORKTREE_DIR = ".worktrees";

export function worktreePathFor(number: number): string {
  return `${WORKTREE_DIR}/agent-${number}`;
}

/**
 * Every command needed to stand a ticket's worktree up, in order, for the caller to join with
 * `&&` so the first failure stops the rest.
 *
 * The `require.resolve` probe is the floor: it fails if the checkout cannot see the install, so
 * the claim stage reports failure rather than handing later stages somewhere nothing runs. `pwd`
 * is last so the path the caller reports is the one git actually created.
 */
export function buildWorktreeCommands(request: WorktreeRequest): string[] {
  const target = worktreePathFor(request.number);
  return [
    `git worktree add -b ${shellQuote(request.branch)} ${shellQuote(target)} origin/main`,
    `cd ${shellQuote(target)}`,
    `node -e ${shellQuote("require.resolve('typescript')")}`,
    "pwd",
  ];
}

// Input arrives on stdin, never as an argv token — the same reason cleanup.ts reads stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, "utf8").trim() || "{}");
  process.stdout.write(JSON.stringify(buildWorktreeCommands(input)));
}
