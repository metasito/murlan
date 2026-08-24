# Autonomous Ticket Pipeline (Phase 0 + Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-time repo/`CLAUDE.md` hygiene pass, then a `Workflow`-driven pipeline (`.claude/workflows/ticket-pipeline.mjs`) that takes one queue ticket from claim to merged with a mandatory independent-review gate and scripted cleanup — no live intervention required except the two supervised trial runs.

**Architecture:** Phase 0 is three sequential audits landing as one PR. Phase 1 is a `Workflow` script that orchestrates fresh, memory-less `agent()` calls per stage (claim → design-first gate → implement → verify → 4-lens review → bounded fix loop → land), with three small pure-logic modules under `lib/ticketPipeline/` doing the deterministic parts (gate decision, verify-check selection, cleanup command list) so those are unit-tested rather than agent-guessed. Every run wraps in try/finally so cleanup always executes.

**Tech Stack:** TypeScript (`lib/`), `node --test` (repo convention, `node --test "tests/**/*.test.ts"`), the `Workflow` tool (plain JS script body, no filesystem/Node API access — orchestrates by spawning `agent()` calls that use Bash), `gh` CLI, Docker (throwaway Postgres for local verification).

**Spec:** `docs/superpowers/specs/2026-08-24-autonomous-ticket-pipeline-design.md`

## Global Constraints

- CI is billing-blocked today (Actions dies with no steps). Phase 1's verify stage defaults to local-substitute verification (throwaway Postgres, container name fixed as `murlan-verify-pg`, port `55433`) — not "push and watch CI."
- Every review lens agent gets **zero memory of the implement stage** — fresh `agent()` call, diff and issue body only.
- The independent-review gate applies to **every** ticket, no size exemption.
- The fix-reverify loop is capped at 2 rounds; hitting the cap escalates to `ready-for-human`, it does not retry indefinitely.
- Cleanup runs in a `finally` block unconditionally — merged, escalated, or errored, cleanup still runs.
- Nothing merges straight to `main`; every landing goes through a PR (`gh pr merge --merge --admin --delete-branch`, matching the existing billing-block precedent).
- Phase 0 edits `CLAUDE.md` and `docs/*.md`; land as one PR, reviewed manually (`/code-review`) since Phase 1's gate doesn't exist until Phase 0 + Phase 1 are both done.
- `docs/agents/issue-tracker.md`'s claim/release mechanics are unchanged — Phase 1 automates following them, it doesn't replace them.

---

## File Structure

| File | Responsibility |
|---|---|
| `CLAUDE.md` | Edited in place (Task 1: Invariants section; Task 11: Working agreement's Autonomy bullet) |
| `docs/*.md` (various) | Deleted if dead/superseded (Task 2) |
| `.scratch/felt.fixed.bak` | Deleted (Task 3) |
| `lib/ticketPipeline/gate.ts` | Pure function: does a ticket need the design-first escalation? Plus a CLI entry so a Bash-capable agent can invoke it. |
| `tests/ticketPipelineGate.test.ts` | Tests for the above |
| `lib/ticketPipeline/verifyPlan.ts` | Pure function: which shell commands verify a given set of touched files, per `docs/agents/loops.md`'s table. Plus CLI entry. |
| `tests/ticketPipelineVerifyPlan.test.ts` | Tests for the above |
| `lib/ticketPipeline/cleanup.ts` | Pure function: given run state (worktree/docker/branch), the ordered teardown commands. Plus CLI entry. |
| `tests/ticketPipelineCleanup.test.ts` | Tests for the above |
| `.claude/workflows/ticket-pipeline.mjs` | The `Workflow` script itself — orchestrates the full per-ticket pipeline |
| `docs/agents/issue-tracker.md` | Task 11: one paragraph pointing at the new pipeline as the standard way to work an item |

---

## Task 1: Audit `CLAUDE.md`'s Invariants and Known Pitfalls sections against source

**Files:**
- Modify: `CLAUDE.md:49-83` (Invariants), `CLAUDE.md:213-223` (Known pitfalls)

**Interfaces:** None — this is a documentation audit, no code.

- [ ] **Step 1: Verify each Invariants bullet against source**

Run each check; record PASS (still true, keep as worded), REDUNDANT (true but a test/lint already enforces it mechanically — cut the prose, keep a one-line pointer to what enforces it), or STALE (no longer true — cut or rewrite):

```bash
# Server authority — spot-check the socket handler validates before broadcasting
grep -n "function\|export" server/socket.ts | grep -i "move\|play\|validate" | head -5

# Ticket auth only — confirm no bare handshake.auth.userId branch exists
grep -rn "handshake.auth.userId" server/

# Listener registration precedes every await
grep -n "socket.on\|await" server/socket.ts | head -30

# Socket singleton
grep -n "export" lib/socket.ts

# Hooks before the null guard, both game screens
grep -n "if (!gameState) return null\|useEffect\|useState" app/index.tsx app/result.tsx

# A card appears exactly once in flight/pileState — find the test that pins this
grep -rln "exactly once\|appears once" tests/

# CARD_W/CARD_H declared once
grep -rn "CARD_W\s*=\|CARD_H\s*=" components/
node --test tests/gameTableModel.test.ts 2>&1 | tail -5

# Impact feedback timed to landing
grep -n "impactDelayMs" components/gameTableModel.ts

# Design tokens used in their named role
node --test tests/tokenRoles.test.ts 2>&1 | tail -5

# A labelled control exposes one accessible node — is this pinned by a test, or prose only?
grep -rln "accessible={false}\|accessibilityElementsHidden" components/ tests/

# Modal supportedOrientations
node --test tests/orientation.test.ts 2>&1 | tail -5

# NotificationBanner never returns null
grep -n "return null" components/NotificationBanner.tsx

# OfflineBanner isConnected === false
grep -n "isConnected" components/OfflineBanner.tsx

# Game invites pendingInvite before banner
grep -n "pendingInvite" context/*.tsx components/*.tsx

# Game rules live in lib/gameEngine.ts, specified by docs/RULES.md
test -f docs/RULES.md && grep -c "^##" docs/RULES.md
```

- [ ] **Step 2: Verify each Known Pitfalls bullet against source**

```bash
# React Compiler / babel-preset-expo dependency
node --test tests/reactCompiler.test.ts 2>&1 | tail -5
grep -n "react-compiler" package.json

# No unit test can see a layout bug — still true? any native layout assertion library added since?
grep -rn "react-test-renderer\|flexbox" package.json
```

- [ ] **Step 3: Apply the audit**

For every bullet marked REDUNDANT: keep one sentence stating the invariant, cut the elaboration, add "(enforced by `<test file>`)" if a test pins it. For every bullet marked STALE: rewrite to match current source, citing the corrected file/line. Do not touch bullets marked PASS. Do not add anything not found by an actual grep in Step 1/2 — this task only tightens what's there.

- [ ] **Step 4: Confirm the doc still reads correctly**

```bash
npx markdownlint CLAUDE.md 2>&1 || true   # informational only, repo has no markdownlint config to fail on
wc -l CLAUDE.md   # record before/after line count for the success criterion
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "Audit CLAUDE.md's invariants and pitfalls against source"
```

---

## Task 2: Sweep `docs/*.md` for dead or superseded files

**Files:**
- Read/delete candidates: `docs/HANDOFF.md`, `docs/BUNDLE.md`, `docs/BETA-PLAYTEST.md`, `docs/ci-cost-research.md`, `docs/albanian-card-terminology-research.md`, `docs/keyboard-avoidance-research.md`, `docs/research/*.md` (5 files), `docs/WEB-PERF.md`
- Kept without question (actively pointed at from `CLAUDE.md` or code): `docs/RULES.md`, `docs/BRIEF.md`, `docs/DEPLOY-RUNBOOK.md`, `docs/TESTING.md`, `docs/ARCHITECTURE.md`, `docs/agents/*.md`, `docs/adr/*.md`, `docs/superpowers/**`

**Interfaces:** None.

- [ ] **Step 1: For each candidate, check whether anything still references it**

```bash
for f in docs/HANDOFF.md docs/BUNDLE.md docs/BETA-PLAYTEST.md docs/ci-cost-research.md \
         docs/albanian-card-terminology-research.md docs/keyboard-avoidance-research.md \
         docs/WEB-PERF.md docs/research/*.md; do
  name=$(basename "$f")
  echo "=== $name ==="
  grep -rln "$name" --include="*.md" --include="*.ts" --include="*.tsx" . \
    | grep -v "^$f$" | grep -v node_modules
done
```

A candidate with zero external references is a strong delete signal. A candidate referenced only by another doc on the *same* delete list doesn't count as a keep.

- [ ] **Step 2: For each candidate with zero references, read it fully and judge against the repo's current state**

A research doc (`docs/research/*.md`, `docs/ci-cost-research.md`, `docs/keyboard-avoidance-research.md`) earns its keep only if a still-relevant decision cites it (checked in Step 1) — otherwise the decision it fed into either shipped (so the research is history, not reference) or didn't (so it's speculative). `docs/HANDOFF.md` and `docs/BETA-PLAYTEST.md` are time-boxed by nature — read them and confirm whether the events/dates they describe are past.

- [ ] **Step 3: Delete what's dead, per `CLAUDE.md`'s own "leave no residue" rule (line 206)**

```bash
git rm docs/<dead-file-1>.md docs/<dead-file-2>.md ...
```

- [ ] **Step 4: Commit**

```bash
git commit -m "Remove superseded and dead docs, verified against current source"
```

---

## Task 3: Remove repo residue

**Files:**
- Delete: `.scratch/felt.fixed.bak`
- Check (do not delete without confirming untracked-and-empty): any other `*.bak` file

**Interfaces:** None.

- [ ] **Step 1: Confirm what's actually residue**

```bash
git status --porcelain --ignored .scratch/
find . -maxdepth 3 -iname "*.bak" -not -path "*/node_modules/*"
```

`.scratch/felt.fixed.bak` is untracked scratch output from a past session (per `CLAUDE.md`'s "leave no residue" rule, line 206) — confirm it isn't referenced by any script before deleting.

```bash
grep -rn "felt.fixed.bak" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.json" .
```

- [ ] **Step 2: Remove it**

```bash
rm .scratch/felt.fixed.bak
```

(Untracked files don't need `git rm`; confirm `git status --short` shows nothing new for it.)

- [ ] **Step 3: Commit if anything tracked changed** (likely nothing — this was untracked)

```bash
git status --short
# If clean, nothing to commit for this step; it's folded into Task 4's PR description instead.
```

---

## Task 4: Open the Phase 0 PR

**Files:** None new — this bundles Tasks 1–3's commits.

**Interfaces:** None.

- [ ] **Step 1: Push the branch and open the PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Audit CLAUDE.md invariants and remove dead docs/residue" --body-file <(cat <<'EOF'
One-time hygiene sweep from docs/superpowers/specs/2026-08-24-autonomous-ticket-pipeline-design.md's Phase 0:
- Every CLAUDE.md invariant and known-pitfall re-verified against source (see commit messages for what changed and why).
- docs/*.md swept for dead/superseded files.
- .scratch/felt.fixed.bak removed.

No behavior change — documentation and repo hygiene only.
EOF
)
```

- [ ] **Step 2: Run the manual two-axis review** (Phase 1's automated gate doesn't exist yet)

Invoke `mattpocock-skills:code-review` against this branch's diff (fixed point: `origin/main`). Fix anything it finds, push, re-review only what changed.

- [ ] **Step 3: Merge**

```bash
gh pr merge --merge --admin --delete-branch
```

`--admin` is the existing precedent for the billing-blocked CI state (see `docs/agents/loops.md`'s "When Actions cannot start" section) — confirm the `scope` job's failure is the known no-steps pattern before using it:

```bash
gh api repos/metasito/murlan/check-runs/<job-id>/annotations
```

---

## Task 5: `lib/ticketPipeline/gate.ts` — the design-first decision

**Files:**
- Create: `lib/ticketPipeline/gate.ts`
- Test: `tests/ticketPipelineGate.test.ts`

**Interfaces:**
- Produces: `needsDesignFirstGate(ticket: { filesTouched: string[]; body: string }): { escalate: boolean; reason: string }` — imported by nothing in-repo (the `Workflow` script can't import files), but called via its CLI entry from `.claude/workflows/ticket-pipeline.mjs` (Task 8).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/ticketPipelineGate.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { needsDesignFirstGate } from "../lib/ticketPipeline/gate.ts";

describe("the design-first gate", () => {
  test("escalates a ticket touching shared/schema.ts with no recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["shared/schema.ts", "server/db.ts"],
      body: "Add a new column to track streaks.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /shared\/schema\.ts/);
  });

  test("does not escalate a schema change with a recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["shared/schema.ts"],
      body: "Add streaks column. Design decision: docs/BRIEF.md §4.2 resolved the column shape.",
    });
    assert.equal(result.escalate, false);
  });

  test("escalates a ticket touching the socket protocol", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["server/socketSchemas.ts", "shared/events.ts"],
      body: "Add a new socket event for spectators.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /socket/);
  });

  test("escalates a ticket touching more than 6 files with no recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: Array.from({ length: 7 }, (_, i) => `components/File${i}.tsx`),
      body: "Rename a prop across the codebase.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /7 files/);
  });

  test("does not escalate a small, ordinary ticket", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["components/SettingsModal.tsx", "locales/en.ts"],
      body: "Fix a mistranslated string.",
    });
    assert.equal(result.escalate, false);
  });

  test("an ADR reference also counts as a recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["shared/schema.ts"],
      body: "Per docs/adr/0002-streaks.md, add the column.",
    });
    assert.equal(result.escalate, false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
node --test tests/ticketPipelineGate.test.ts
```

Expected: fails on the import — `lib/ticketPipeline/gate.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

```typescript
// lib/ticketPipeline/gate.ts
const SCHEMA_FILE = "shared/schema.ts";
const SOCKET_PATTERN = /server\/socket|shared\/events\.ts/;
const FILE_COUNT_THRESHOLD = 6;
const DECISION_POINTER = /docs\/BRIEF\.md\s*§|docs\/adr\/|Design decision:/;

export interface TicketFacts {
  filesTouched: string[];
  body: string;
}

export interface GateVerdict {
  escalate: boolean;
  reason: string;
}

export function needsDesignFirstGate(ticket: TicketFacts): GateVerdict {
  const hasDecision = DECISION_POINTER.test(ticket.body);
  if (hasDecision) return { escalate: false, reason: "" };

  if (ticket.filesTouched.includes(SCHEMA_FILE)) {
    return { escalate: true, reason: `touches ${SCHEMA_FILE} with no recorded decision` };
  }
  if (ticket.filesTouched.some((f) => SOCKET_PATTERN.test(f))) {
    return { escalate: true, reason: "touches the socket protocol with no recorded decision" };
  }
  if (ticket.filesTouched.length > FILE_COUNT_THRESHOLD) {
    return {
      escalate: true,
      reason: `touches ${ticket.filesTouched.length} files with no recorded decision`,
    };
  }
  return { escalate: false, reason: "" };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const input = JSON.parse(process.argv[2] ?? "{}");
  process.stdout.write(JSON.stringify(needsDesignFirstGate(input)));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
node --test tests/ticketPipelineGate.test.ts
```

Expected: 6/6 pass.

- [ ] **Step 5: Confirm the CLI entry works** (this is how the `Workflow` script will actually invoke it)

```bash
npx tsx lib/ticketPipeline/gate.ts '{"filesTouched":["shared/schema.ts"],"body":"no decision here"}'
```

Expected stdout: `{"escalate":true,"reason":"touches shared/schema.ts with no recorded decision"}`

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/ticketPipeline/gate.ts tests/ticketPipelineGate.test.ts
git commit -m "Add the design-first gate as a pure, tested function"
```

---

## Task 6: `lib/ticketPipeline/verifyPlan.ts` — which checks a diff needs

**Files:**
- Create: `lib/ticketPipeline/verifyPlan.ts`
- Test: `tests/ticketPipelineVerifyPlan.test.ts`

**Interfaces:**
- Produces: `pickVerifyChecks(filesTouched: string[]): string[]` — an ordered list of shell commands, per `docs/agents/loops.md`'s "Pick the loop by what you changed" table. Called via CLI entry from Task 8's script.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/ticketPipelineVerifyPlan.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickVerifyChecks } from "../lib/ticketPipeline/verifyPlan.ts";

describe("picking verify checks by files touched", () => {
  test("pure lib/ logic gets the node --test loop only", () => {
    const checks = pickVerifyChecks(["lib/gameEngine.ts", "lib/rating.ts"]);
    assert.deepEqual(checks, [`node --test "tests/**/*.test.ts"`]);
  });

  test("a native component gets jest added", () => {
    const checks = pickVerifyChecks(["components/GameTable.tsx"]);
    assert.ok(checks.includes("npx jest components tests"));
  });

  test("anything under app/ or with layout in the name gets Playwright added", () => {
    const checks = pickVerifyChecks(["app/index.tsx"]);
    assert.ok(checks.some((c) => c.includes("playwright")));
  });

  test("locale files get the i18n test added", () => {
    const checks = pickVerifyChecks(["locales/it.ts"]);
    assert.ok(checks.some((c) => c.includes("i18n.test.ts")));
  });

  test("touching lib/theme.ts adds the token/contrast floors", () => {
    const checks = pickVerifyChecks(["lib/theme.ts"]);
    assert.ok(checks.some((c) => c.includes("tokenRoles.test.ts")));
  });

  test("checks never duplicate across overlapping file categories", () => {
    const checks = pickVerifyChecks(["lib/gameEngine.ts", "lib/rating.ts", "lib/theme.ts"]);
    assert.equal(checks.length, new Set(checks).size);
  });

  test("an unrecognized file still gets the baseline node --test loop", () => {
    const checks = pickVerifyChecks(["README.md"]);
    assert.ok(checks.includes(`node --test "tests/**/*.test.ts"`));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
node --test tests/ticketPipelineVerifyPlan.test.ts
```

Expected: fails — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/ticketPipeline/verifyPlan.ts
const BASELINE = `node --test "tests/**/*.test.ts"`;

const RULES: { pattern: RegExp; command: string }[] = [
  { pattern: /^components\//, command: "npx jest components tests" },
  { pattern: /^app\//, command: "npx playwright test tests/e2e" },
  { pattern: /locale|locales\//, command: `node --test tests/i18n.test.ts` },
  {
    pattern: /^lib\/theme\.ts$/,
    command: `node --test tests/tokenRoles.test.ts tests/contrast.test.ts tests/cosmetics.test.ts`,
  },
  { pattern: /gameTableModel|handLayout|cardFaceModel/, command: `node --test tests/gameTableModel.test.ts` },
];

export function pickVerifyChecks(filesTouched: string[]): string[] {
  const checks = new Set<string>([BASELINE]);
  for (const file of filesTouched) {
    for (const rule of RULES) {
      if (rule.pattern.test(file)) checks.add(rule.command);
    }
  }
  return Array.from(checks);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const input = JSON.parse(process.argv[2] ?? "[]");
  process.stdout.write(JSON.stringify(pickVerifyChecks(input)));
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
node --test tests/ticketPipelineVerifyPlan.test.ts
```

Expected: 7/7 pass.

- [ ] **Step 5: Confirm the CLI entry**

```bash
npx tsx lib/ticketPipeline/verifyPlan.ts '["components/GameTable.tsx"]'
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/ticketPipeline/verifyPlan.ts tests/ticketPipelineVerifyPlan.test.ts
git commit -m "Add verify-check selection as a pure, tested function"
```

---

## Task 7: `lib/ticketPipeline/cleanup.ts` — the teardown command list

**Files:**
- Create: `lib/ticketPipeline/cleanup.ts`
- Test: `tests/ticketPipelineCleanup.test.ts`

**Interfaces:**
- Produces: `buildCleanupCommands(state: RunState): string[]` where `RunState = { worktreePath: string | null; dockerStarted: boolean; localBranch: string | null; merged: boolean }`. Called via CLI entry from Task 8's `finally` block.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/ticketPipelineCleanup.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCleanupCommands } from "../lib/ticketPipeline/cleanup.ts";

describe("building the cleanup command list", () => {
  test("a merged run with no worktree and no docker needs no teardown beyond the status check", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/1-x", merged: true });
    assert.deepEqual(cmds, ["git status --short"]);
  });

  test("a run that started docker gets it removed by fixed name", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: true, localBranch: null, merged: true });
    assert.ok(cmds.includes("docker rm -f murlan-verify-pg"));
  });

  test("a run in a worktree gets it force-removed", () => {
    const cmds = buildCleanupCommands({ worktreePath: ".worktrees/agent-1", dockerStarted: false, localBranch: null, merged: true });
    assert.ok(cmds.includes("git worktree remove .worktrees/agent-1 --force"));
  });

  test("an abandoned (not merged) run deletes its local branch", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/2-y", merged: false });
    assert.ok(cmds.includes("git branch -D agent/2-y"));
  });

  test("a merged run does not delete the local branch (gh pr merge --delete-branch already handled it)", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/3-z", merged: true });
    assert.ok(!cmds.some((c) => c.includes("git branch -D")));
  });

  test("git status --short is always last", () => {
    const cmds = buildCleanupCommands({ worktreePath: ".worktrees/a", dockerStarted: true, localBranch: "agent/4-w", merged: false });
    assert.equal(cmds[cmds.length - 1], "git status --short");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
node --test tests/ticketPipelineCleanup.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// lib/ticketPipeline/cleanup.ts
export interface RunState {
  worktreePath: string | null;
  dockerStarted: boolean;
  localBranch: string | null;
  merged: boolean;
}

export function buildCleanupCommands(state: RunState): string[] {
  const commands: string[] = [];
  if (state.worktreePath) {
    commands.push(`git worktree remove ${state.worktreePath} --force`);
  }
  if (state.dockerStarted) {
    commands.push("docker rm -f murlan-verify-pg");
  }
  if (state.localBranch && !state.merged) {
    commands.push(`git branch -D ${state.localBranch}`);
  }
  commands.push("git status --short");
  return commands;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const input = JSON.parse(process.argv[2] ?? "{}");
  process.stdout.write(JSON.stringify(buildCleanupCommands(input)));
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
node --test tests/ticketPipelineCleanup.test.ts
```

Expected: 6/6 pass.

- [ ] **Step 5: Confirm the CLI entry**

```bash
npx tsx lib/ticketPipeline/cleanup.ts '{"worktreePath":null,"dockerStarted":true,"localBranch":"agent/1-x","merged":false}'
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/ticketPipeline/cleanup.ts tests/ticketPipelineCleanup.test.ts
git commit -m "Add cleanup command list as a pure, tested function"
```

---

## Task 8: `.claude/workflows/ticket-pipeline.mjs` — the orchestration script

**Files:**
- Create: `.claude/workflows/ticket-pipeline.mjs`

**Interfaces:**
- Consumes: `needsDesignFirstGate`, `pickVerifyChecks`, `buildCleanupCommands` — not imported (Workflow scripts have no filesystem access); invoked by prompting an `agent()` to run their CLI entries via Bash and report the parsed stdout through a schema.
- Produces: the workflow's return value `{ landed: boolean, reason?: string, prNumber?: number, ticket?: number }`, read by whoever runs the workflow (the supervised trial in Task 9, and later the queue-processing entry point).

This task has no isolated unit test — a `Workflow` script's correctness is in how its `agent()` calls are orchestrated, which only proves out by running real agents (costly) or by the supervised live trial (Task 9). Build it once, correctly, self-reviewed against the spec's stage list, then prove it in Task 9.

- [ ] **Step 1: Write the script**

```javascript
export const meta = {
  name: 'ticket-pipeline',
  description: 'Claim, gate, implement, verify, independently review, and land one murlan queue ticket end to end',
  phases: [
    { title: 'Claim' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Review' },
    { title: 'Fix' },
    { title: 'Land' },
    { title: 'Cleanup' },
  ],
}

const CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    claimed: { type: 'boolean' },
    number: { type: 'number' },
    branch: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['claimed'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: { escalate: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['escalate', 'reason'],
}

const IMPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
  },
  required: ['committed'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    dockerStarted: { type: 'boolean' },
    output: { type: 'string' },
  },
  required: ['pass', 'dockerStarted'],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REJECTED'] },
        },
        required: ['file', 'summary', 'verdict'],
      },
    },
  },
  required: ['findings'],
}

const LAND_SCHEMA = {
  type: 'object',
  properties: { merged: { type: 'boolean' }, prNumber: { type: 'number' }, reason: { type: 'string' } },
  required: ['merged'],
}

async function runVerify(filesTouched) {
  const filesInput = JSON.stringify(filesTouched || []).replace(/'/g, "'\\''")
  return agent(
    `Run: npx tsx lib/ticketPipeline/verifyPlan.ts '${filesInput}'
That prints a JSON array of shell commands to run, in order. If any command needs a
database, start a throwaway Postgres first with a FIXED name so cleanup can find it:
docker run -d --name murlan-verify-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
-e POSTGRES_DB=murlan_test -p 55433:5432 postgres:16-alpine
then wait for pg_isready, then set DATABASE_URL=postgres://postgres:postgres@localhost:55433/murlan_test
and SESSION_SECRET=verify-local for every command in the plan. Run every command from the plan in order.
Report pass (true only if every command exited 0), dockerStarted (whether you started the container),
output (tail of any failing command's output).`,
    { phase: 'Verify', schema: VERIFY_SCHEMA }
  )
}

async function runReview(claim, scopeNote) {
  const diffScope = scopeNote ? `only the fix for: ${scopeNote}` : 'the whole diff'
  const lenses = [
    {
      key: 'standards',
      prompt: `Review ${diffScope} on branch ${claim.branch} (git diff origin/main...HEAD) using
mattpocock-skills:code-review's standards axis: documented repo conventions (CLAUDE.md) plus the
Fowler smell baseline. You did not write this code — read it cold. Report findings: file, line,
summary, verdict (CONFIRMED/PLAUSIBLE/REJECTED).`,
    },
    {
      key: 'spec',
      prompt: `Review ${diffScope} on branch ${claim.branch} (git diff origin/main...HEAD) against
issue #${claim.number}'s body:\n${claim.body}\nUsing mattpocock-skills:code-review's spec axis:
missing requirements, scope creep, anything implemented but wrong. Report findings: file, line,
summary, verdict (CONFIRMED/PLAUSIBLE/REJECTED).`,
    },
    {
      key: 'adversarial',
      prompt: `For every new or changed test or runtime guard in ${diffScope} on branch ${claim.branch}
(git diff origin/main...HEAD): try to prove it passes on broken code — invert or delete the logic it
claims to protect, rerun it, confirm whether it would actually catch the break. Any test/guard that
still passes on broken code is a CONFIRMED finding. Report: file, line, summary, verdict.`,
    },
    {
      key: 'comments',
      prompt: `Every new or changed comment in ${diffScope} on branch ${claim.branch}
(git diff origin/main...HEAD), checked against CLAUDE.md's comment policy (lines 85-98): a comment
only earns its place by naming an invisible constraint, a non-obvious why, a contract types can't
carry, or a pointer to authority. Flag as CONFIRMED anything that narrates history, restates the
code below it, or explains an already-fixed defect. Report: file, line, summary, verdict.`,
    },
  ]
  const results = await parallel(
    lenses.map((l) => () => agent(l.prompt, { phase: 'Review', label: `review:${l.key}`, schema: FINDING_SCHEMA }))
  )
  return { findings: results.filter(Boolean).flatMap((r) => r.findings) }
}

const state = { worktreePath: null, dockerStarted: false, localBranch: null, merged: false }

try {
  phase('Claim')
  const claim = await agent(
    `Run: node scripts/next-ticket.mjs
Take the routed ticket only if it's frontier implement work (ready-for-agent). If it routes to
triage/wayfinder/handoff instead, report claimed: false with why. Otherwise claim it per
docs/agents/issue-tracker.md: add the in-progress label, comment naming the branch you'll use
(agent/<number>-<slug>), then re-view the issue to confirm you won the race (stand down if an
older claim is already there). Report: claimed, number, branch, title, body (the full issue body),
filesTouched (best-effort list from the issue's Ground truth pointers), reason.`,
    { phase: 'Claim', schema: CLAIM_SCHEMA }
  )
  if (!claim.claimed) {
    log(`Nothing claimed: ${claim.reason}`)
    return { landed: false, reason: claim.reason }
  }
  state.localBranch = claim.branch

  const gateInput = JSON.stringify({ filesTouched: claim.filesTouched, body: claim.body }).replace(/'/g, "'\\''")
  const gate = await agent(
    `Run: npx tsx lib/ticketPipeline/gate.ts '${gateInput}'
Report its JSON stdout verbatim as escalate and reason.`,
    { phase: 'Claim', schema: GATE_SCHEMA }
  )
  if (gate.escalate) {
    await agent(
      `Issue #${claim.number}: remove the in-progress label, add ready-for-human, comment explaining
this needs an owner decision: ${gate.reason}`,
      { phase: 'Claim' }
    )
    return { landed: false, reason: `escalated: ${gate.reason}` }
  }

  phase('Implement')
  const impl = await agent(
    `Create branch ${claim.branch} from origin/main if it doesn't exist locally, check it out.
Implement issue #${claim.number} via the mattpocock-skills:implement workflow — TDD at pre-agreed
seams, typecheck and single test files while iterating. Issue body:\n${claim.body}\nCommit your
work (do not push yet). Report: committed, commitSha, summary, filesTouched.`,
    { phase: 'Implement', schema: IMPLEMENT_SCHEMA }
  )
  if (!impl.committed) {
    await agent(
      `Issue #${claim.number}: remove the in-progress label, add ready-for-human, comment that
implementation didn't complete: ${impl.summary || 'no reason given'}`,
      { phase: 'Implement' }
    )
    return { landed: false, reason: 'implement failed' }
  }

  phase('Verify')
  let verify = await runVerify(impl.filesTouched)
  state.dockerStarted = state.dockerStarted || verify.dockerStarted

  phase('Review')
  let review = await runReview(claim, null)
  let round = 0
  while (review.findings.some((f) => f.verdict === 'CONFIRMED') && round < 2) {
    round++
    phase('Fix')
    const confirmed = review.findings.filter((f) => f.verdict === 'CONFIRMED')
    const fix = await agent(
      `On branch ${claim.branch}, fix exactly these findings and nothing else, then commit:\n${confirmed
        .map((f) => `- ${f.file}${f.line ? ':' + f.line : ''} — ${f.summary}`)
        .join('\n')}`,
      { phase: 'Fix', schema: IMPLEMENT_SCHEMA }
    )
    if (!fix.committed) break
    verify = await runVerify(fix.filesTouched)
    state.dockerStarted = state.dockerStarted || verify.dockerStarted
    review = await runReview(claim, confirmed.map((f) => f.summary).join('; '))
  }

  if (!verify.pass || review.findings.some((f) => f.verdict === 'CONFIRMED')) {
    await agent(
      `Issue #${claim.number}: remove the in-progress label, add ready-for-human, comment that
${round} fix round(s) didn't reach a clean state. Remaining: ${JSON.stringify(
        review.findings.filter((f) => f.verdict === 'CONFIRMED')
      )}. Verify pass: ${verify.pass}.`,
      { phase: 'Land' }
    )
    return { landed: false, reason: 'capped at 2 fix rounds without a clean state' }
  }

  phase('Land')
  const land = await agent(
    `Branch ${claim.branch} is clean (local verify passed, independent review clean). Push it, open a
PR that closes #${claim.number} (put "Closes #${claim.number}" in the PR body only, never the commit
message). CI is billing-blocked today — check the run once; if the scope job dies with no steps (the
known billing failure, confirm via gh api repos/metasito/murlan/check-runs/<id>/annotations), don't
wait on it further. Merge with gh pr merge --merge --admin --delete-branch, then close #${claim.number}
with a comment summarizing what shipped. Report: merged, prNumber, reason.`,
    { phase: 'Land', schema: LAND_SCHEMA }
  )
  state.merged = land.merged
  return { landed: land.merged, prNumber: land.prNumber, ticket: claim.number, reason: land.reason }
} finally {
  phase('Cleanup')
  const cleanupInput = JSON.stringify(state).replace(/'/g, "'\\''")
  const cleaned = await agent(
    `Run: npx tsx lib/ticketPipeline/cleanup.ts '${cleanupInput}'
That prints a JSON array of shell commands. Run each one in order, tolerating "not found"-type
errors (idempotent teardown — a container or worktree that's already gone is not a failure). Report
the final "git status --short" output verbatim.`,
    { phase: 'Cleanup' }
  )
  log(`Cleanup finished: ${cleaned}`)
}
```

- [ ] **Step 2: Self-review the script against the spec's stage diagram**

Re-read `docs/superpowers/specs/2026-08-24-autonomous-ticket-pipeline-design.md`'s Phase 1 "Shape" block line by line against the script above — confirm every arrow in the diagram has a corresponding stage, the fix-loop cap is 2, the four lenses match the spec's four bullets, and the `finally` block runs regardless of which `return` was hit.

- [ ] **Step 3: Commit**

```bash
mkdir -p .claude/workflows
git add .claude/workflows/ticket-pipeline.mjs
git commit -m "Add the ticket-pipeline Workflow script"
```

---

## Task 9: Supervised trial run #1

**Files:** None created — this is a live run, watched.

- [ ] **Step 1: Pick a real, small frontier ticket**

```bash
node scripts/next-ticket.mjs
```

Prefer a `size:XS`/`size:S` ticket for the first trial — smaller blast radius if something in the orchestration is wrong.

- [ ] **Step 2: Run the workflow, watching**

Invoke `Workflow({ name: 'ticket-pipeline' })` and stay present — check in at each phase transition (`/workflows` shows live progress per the tool's own description). Do not let it merge unattended on this first run: pause it before the Land stage's `gh pr merge` if anything looks off.

- [ ] **Step 3: Record what actually happened vs. what the script intended**

For each stage: did the claim race-check work, did the gate correctly not escalate an ordinary ticket, did verify actually spin up and tear down Postgres, did all four review lenses return real findings (not empty schemas from a confused agent), did the land stage correctly handle the billing-blocked CI. Note every divergence.

- [ ] **Step 4: Fix any divergence found, in `.claude/workflows/ticket-pipeline.mjs` or the `lib/ticketPipeline/*.ts` modules, with its own commit**

If the fix is in a `lib/ticketPipeline/*.ts` module, add a test case reproducing the gap before fixing it (same TDD discipline as Tasks 5–7).

---

## Task 10: Supervised trial run #2

**Files:** None created.

- [ ] **Step 1: Pick a second real frontier ticket, ideally a different shape than trial #1** (e.g., if #1 was a pure-logic fix, pick one touching a component this time, to exercise a different `pickVerifyChecks` branch)

- [ ] **Step 2: Run the workflow, watching, same as Task 9**

- [ ] **Step 3: If this run is clean end-to-end with no divergence from Task 9's fixes** — the trial is done; proceed to Task 11. If not, repeat the fix-and-rerun cycle from Task 9 Step 4 before declaring the trial complete. (Two *clean* runs are the bar, not two attempts.)

---

## Task 11: Make the pipeline the standard path

**Files:**
- Modify: `CLAUDE.md:117-131` (the Autonomy bullet), `CLAUDE.md:181-186` (Review-depth bullet — superseded by the always-on gate)
- Modify: `docs/agents/issue-tracker.md` (one paragraph pointing at the pipeline)

**Interfaces:** None.

- [ ] **Step 1: Rewrite the Autonomy bullet**

Replace `CLAUDE.md:119-131` (starting "**Autonomy.** Work the queue...") with a version that names `Workflow({ name: 'ticket-pipeline' })` as the standard way to work a queue item, keeping everything the current bullet still says correctly (one item at a time, `scripts/next-ticket.mjs` for the route, `docs/agents/issue-tracker.md` for claim mechanics) and removing what the pipeline now does mechanically (the `gh run watch` / `--json conclusion` instruction moves into the pipeline's Land stage, not something to repeat by hand for a pipeline-run ticket — keep it worded for the case where the pipeline can't be used, e.g. a `ready-for-human` item worked by hand).

- [ ] **Step 2: Remove or fold the size-gated review-depth bullet (`CLAUDE.md:181-186`)**

The pipeline's review gate applies to every ticket regardless of size (per this plan's Global Constraints) — this makes the existing "review depth follows the size label" bullet stale for anything run through the pipeline. Rewrite it to describe the *actual* remaining case: manual work outside the pipeline (e.g. a `ready-for-human` item, or Phase 0-style hygiene work) still uses `mattpocock-skills:code-review` scaled by size, since the pipeline's four-lens gate isn't available there.

- [ ] **Step 3: Add the pointer in `docs/agents/issue-tracker.md`**

One paragraph near the top of the "Claiming an item" section: the standard way to work a routed ticket is `Workflow({ name: 'ticket-pipeline' })` (`.claude/workflows/ticket-pipeline.mjs`), which handles claim/gate/implement/verify/review/land/cleanup per `docs/superpowers/specs/2026-08-24-autonomous-ticket-pipeline-design.md`; the manual steps below remain accurate for anything worked outside the pipeline.

- [ ] **Step 4: Commit, push, open a PR, get it reviewed and merged**

```bash
git add CLAUDE.md docs/agents/issue-tracker.md
git commit -m "Make the ticket-pipeline workflow the standard way to work a queue item"
git push -u origin <branch-name>
gh pr create --title "Adopt the ticket-pipeline workflow in the working agreement" --body-file <(cat <<'EOF'
Closes out docs/superpowers/specs/2026-08-24-autonomous-ticket-pipeline-design.md's Phase 1
after two clean supervised trial runs (see PR history for tasks 9-10's fix commits, if any).
EOF
)
```

Run `mattpocock-skills:code-review` against this PR manually (still the pipeline's own PR, so its own gate doesn't apply to itself), then:

```bash
gh pr merge --merge --admin --delete-branch
```

---

## Self-Review Notes

- **Spec coverage:** Phase 0's three audits (Tasks 1–4), Phase 1's shape/gate/lenses/cleanup/adoption (Tasks 5–11) all map directly to the spec's Phase 0 and Phase 1 sections. Phase 2 (parallel fleet) is intentionally out of scope per the user's "up to phase 1" instruction.
- **Placeholder scan:** every step above has literal commands or literal code; the two doc-audit tasks (1, 2) necessarily leave the keep/cut *decision* to execution time (the fact isn't knowable until the grep runs), but the verification method and disposition rule are concrete, not hand-waved.
- **Type consistency:** `RunState`/`GateVerdict`/`TicketFacts` types in Tasks 5 and 7 match their CLI-entry JSON shapes; the `Workflow` script's schemas (Task 8) match the field names each `lib/ticketPipeline/*.ts` CLI prints.
