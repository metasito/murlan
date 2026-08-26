# Rebuilding the ticket pipeline

Handover for a fresh session. Read this whole file first; it is the spec, the measurements and
the traps. The work is approved — the owner picked the full rebuild over two smaller options.

---

## 1. The verdict

`.claude/workflows/ticket-pipeline.mjs` is **deterministic code, wrapped in English, executed by
a language model, to work around a sandbox that will not run code.**

The `Workflow` harness gives its script `agent()` and nothing else — no filesystem, no shell, no
network. So every deterministic action (claim a ticket, read a CI verdict, merge, tear down a
worktree) is performed by instantiating a model and asking it in prose to run a command. That is
why `lib/ticketPipeline/*.ts` exist as CLIs invoked from prompts saying *"run exactly what this
prints"*.

**51% of the file's characters are prose inside template literals.** Untyped, unlinted, and
untested until a parse check was added in #355.

This is the root cause. Sixteen defects were fixed in twelve cycles; most were symptoms of it.

---

## 2. Measurements

Three real runs, from agent transcripts under
`~/.claude/projects/C--Users-roton-murlan/<session>/subagents/workflows/<runId>/`.

| Run | Agents | Context setup | Thinking output | Ratio |
|---|---|---|---|---|
| #224 (leanest achieved) | 6 | 811k | 20,253 | **40×** |
| #212 | 6 | 970k | 63,593 | 15× |
| #200 (one fix round) | 8 | 2,650k | 101,204 | 26× |

#224 stage by stage — the leanest run the current design can produce:

| Stage | Model | Tool calls | Setup | Output | Wall |
|---|---|---|---|---|---|
| Claim | haiku | 12 | 18k | 1,540 | 2.2m |
| Implement | sonnet | 47 | 214k | 2,234 | 9.4m |
| Review | opus | 27 | 250k | 15,631 | 8.8m |
| **Verify** | sonnet | **3** | **163k** | **16** | 9.4m |
| **Land** | sonnet | **4** | **82k** | 339 | 0.6m |
| **Cleanup** | sonnet | **3** | **84k** | 493 | 0.6m |

**Four of six agents make ≤12 tool calls and cost 347k of setup for 22 calls.** Verify is a model
loaded with all of `CLAUDE.md`, every tool schema and a 1,700-character prompt, in order to run one
blocking command and emit 16 tokens of JSON.

For contrast, the same pipeline against the night measured in #320: 2 of 12 runs landed for 9.2M
tokens. After the twelve fix cycles: 5 of 6 implement runs landed for 3.46M — 4.6M per landed
ticket down to 648k. The architecture did not change. Those numbers measure defect removal, and
they are the ceiling of what patching can reach.

---

## 3. The sixteen defects, and which are structural

Fixed in #355, #357, #360, #362, #364, #366, #369, #371, #372. Marked **S** where the root cause
above is the reason the defect was possible at all.

| Defect | S |
|---|---|
| Review dispatched `/code-review` as a child it could not await, then slept and polled `git status` — ~6 min of Opus per run | **S** — the script can await nothing but `agent()` |
| `ciVerdict` read `gh run list --limit 1` with no workflow filter; a green Maestro over a red CI would have merged a red branch | |
| An unreadable run reported as red with no `infrastructure` flag → up to four 9-minute fix rounds chasing nothing | |
| Nothing parsed the workflow script; two unescaped-backtick breakages passed `agent:check` | **S** |
| Gate counted the three locale files as three decisions | |
| `ready-for-agent` tickets with open `## What to settle` boxes were not caught | |
| RULES.md offered a Playwright spec as the *iterating* loop; #349 ran it 7× (58 of 85 min) | |
| Playwright collects only from `tests/e2e`, and reports it only after a full Metro rebuild | |
| Review had no idea what Implement proved, so the 2-min native suite ran 3× per ticket | **S** — no return channel but prose |
| `gh --log-failed` is 14MB, Node's buffer 1MB → ENOBUFS → *"could not read the failed log"*. **Every fix round in the pipeline's history flew blind**; #200's spent 76 min rediscovering a failure the log named | **S** — CLI reached through a prompt, not a call |
| Dependency gate fired on the `package.json` path alone | |
| A dead verify agent treated as a broken CI; two correct green PRs abandoned | |
| **The gate read its own escalation comments as input** — self-sustaining loop, #278 escalated twice on five dependency hits, none from its spec | **S** — input assembled by a `jq` string inside a prompt |
| Cleanup's JSON payload lost its backslashes through the shell | **S** |
| `impl.summary` — plain property access on the line after `impl?.committed`, inside the branch that only runs when `impl` is null. Threw on a network blip, skipped the claim release, left #278 `in-progress` with a worktree standing | **S** — error paths in a 635-line prose file are never exercised |
| Trivial-agent overhead itself (347k for 22 tool calls) | **S** |

Note the last row of the "not structural" set is still a symptom: they were *found late* because the
control flow is unreadable and untestable.

---

## 4. The replacement

`scripts/ticket-pipeline.mjs` — a plain Node script. `npm run ticket` runs it.

```
import { classify }              from './next-ticket.mjs'
import { needsDesignFirstGate }  from '../lib/ticketPipeline/gate.ts'
import { claimTicket, releaseTicket, wonTheClaim } from '../lib/ticketPipeline/claim.ts'
import { buildWorktreeCommands, worktreePathFor }  from '../lib/ticketPipeline/worktree.ts'
import { readVerdict }           from '../lib/ticketPipeline/ciVerdict.ts'
import { decideLanding, mergeArgs } from '../lib/ticketPipeline/land.ts'
import { buildCleanupCommands }  from '../lib/ticketPipeline/cleanup.ts'
```

Everything above is already written and already tested (§5). The script calls them as functions.

**Two agents only**, spawned with the `claude` CLI (2.1.245, on PATH at
`/c/Users/roton/.local/bin/claude`):

| Step | Runner | Why |
|---|---|---|
| pick, claim, worktree, gate | **Node** | Deterministic. `classify()` + `claimTicket()` + `needsDesignFirstGate()`. |
| **implement** | `claude -p` | Judgement. Prompt from `docs/agents/pipeline/implement.md`. |
| **review** | `claude -p` | Judgement. Prompt from `docs/agents/pipeline/review.md`. |
| push, open PR | **Node** | `execFileSync('gh', …)`. |
| verify | **Node** | `readVerdict()` — a blocking call, no model attached. |
| fix round | `claude -p` | Only entered when CI is genuinely red. |
| land | **Node** | `decideLanding()` + `mergeArgs()`. |
| cleanup | **Node** | `buildCleanupCommands()`, in a `finally`. |

Projected against #224: 6 agents → 2, setup 811k → ~460k, claim 2.2m → ~5s, land 0.6m → ~2s,
cleanup 0.6m → ~1s, and verify's 9.4m becomes 9.4m of CI with no model attached.

### What this deletes permanently

- Prompt-assembled `jq` (caused the gate feedback loop)
- Prompt-assembled JSON (caused the backslash collapse)
- *"Run exactly what this prints"* drift
- English as control flow, and every unescaped-backtick class of failure
- Untested error paths — a Node script's `catch` is ordinary code with ordinary tests

### Prompts

`docs/agents/pipeline/implement.md` and `review.md`. Ordinary reviewable, greppable, diffable
files that a Node script reads with `readFileSync`. This is proposal 1 of **#320**, and it becomes
trivial once the runner can touch the filesystem.

Keep them short. `docs/agents/RULES.md` is the normative ruleset and
`tests/rulesAreSingleSourced.test.ts` fails if a prompt restates a rule — point, never repeat.

### Hard requirements

- **`ci.yml` stays the only gate.** Never `--admin`. `decideLanding()` already encodes this.
- **The claim protocol is unchanged** — `in-progress` label plus a comment naming the branch, and
  `wonTheClaim()` for the race. Sessions share one GitHub account; the branch name is the only
  thing that distinguishes them.
- **Release the claim on every exit path.** This is what the old code got wrong twice. In Node it
  is one `finally` with real tests behind it.
- **Stage by pathspec, never `git add -A`** (RULES.md rule 11) — parallel sessions share an index.

---

## 5. Inventory — what already exists

| File | Lines | Test |
|---|---|---|
| `lib/ticketPipeline/ciVerdict.ts` | 211 | `tests/ciVerdict.test.ts` |
| `lib/ticketPipeline/claim.ts` | 92 | `tests/claimTicket.test.ts` |
| `lib/ticketPipeline/cleanup.ts` | 88 | `tests/ticketPipelineCleanup.test.ts` |
| `lib/ticketPipeline/gate.ts` | 98 | `tests/ticketPipelineGate.test.ts` |
| `lib/ticketPipeline/land.ts` | 70 | — |
| `lib/ticketPipeline/worktree.ts` | 50 | `tests/ticketPipelineWorktree.test.ts` |
| `scripts/next-ticket.mjs` | 205 | `tests/nextTicket.test.ts` |

`tests/ticketPipelinePrompts.test.ts` pins properties of the **old** `.mjs`. Rewrite or delete it
with the file; do not leave it pinning something that no longer exists.

Several modules return **command strings** (`buildCleanupCommands`, `buildWorktreeCommands`)
because a prompt had to run them. A Node runner can `execFileSync` them directly. Returning strings
is still reasonable — it keeps the modules pure and testable — but the decision is now open rather
than forced.

---

## 6. Decisions taken

The owner settled these. Build to them; do not reopen them.

| Question | Decision |
|---|---|
| Does a size floor skip the pipeline? | **No floor. Every size uses it.** Once orchestration is two agents and scripts do claim, label, comment, push, verify, merge and cleanup, the overhead over working by hand is about ten seconds of Node. Implement and review are costs you pay whenever a model does the work at all. |
| Review model tier | **Opus for `size:M` and up; Sonnet for `size:XS`/`size:S`.** Anything touching the engine, the socket protocol or auth takes Opus regardless of label. This is what `CLAUDE.md`'s review-depth wording already said and the old pipeline ignored. |
| The red iOS Maestro job | **Disabled on pull requests** (#374), `workflow_dispatch` only, until #354 turns both device loops green. It had been red on `main` since `0d2f355` and gated nothing. Do not build the runner to wait on it. |
| The bots | Owner: *“idk which bot, they are all bad in general.”* Root cause found and #350 reframed — **the game records no play history at all**, so no bot at any tier can count cards. #216 and #223 are downstream of it. Not pipeline work, but do not let a rebuild agent “fix” bot tuning on the way past. |

### Still open, and yours to decide while building

- **How `claude -p` reports back.** Options: `--output-format json`, or have the agent write a
  result file the runner reads. The second is simpler to test. Technical call, not an owner one.
- **Whether `buildCleanupCommands` / `buildWorktreeCommands` keep returning command strings.**
  They do so because a prompt had to run them. Strings stay testable and pure; a Node runner could
  equally call `execFileSync` itself. Either is defensible now that it is not forced.

### Must move together

- **`.claude/commands/ticket.md` and `docs/agents/RULES.md` rule 25** both name the Workflow path.
  Update both in the same change, or the rule and the tool disagree — which
  `tests/rulesAreSingleSourced.test.ts` exists to catch.
- **Delete `.claude/workflows/ticket-pipeline.mjs`** once the replacement lands one ticket. Approved.
  Do not leave two runners.
- **`tests/ticketPipelinePrompts.test.ts`** pins properties of the old file. It goes with it.

## 7. Traps, learned the expensive way

- **Playwright.** `testDir` is `tests/e2e`; a spec anywhere else matches nothing *and still pays a
  full Metro rebuild before saying so*. `playwright.config.ts` starts its own `webServer` — never
  start one by hand. Never put it in an iterate loop (RULES.md rules 4–5).
- **`gh` output is huge.** Always pass `maxBuffer`; the default 1MB throws ENOBUFS on any real log.
  `ghExecOptions()` in `ciVerdict.ts` is the shared answer.
- **`gh run list --branch X --limit 1` is not ci.yml.** Maestro and EAS run on the same branch.
  Filter by `--workflow ci.yml` and match `headSha` against the PR's head, or a fix round reads the
  previous push's verdict.
- **A dead agent is not a failed check.** Distinguish "our side blipped" from "CI is broken"; two
  correct green PRs were thrown away for want of that.
- **Never feed a tool its own output.** The gate commented on issues and then read its comments.
  Keep `body` and `comments` separate — every input channel needs this checked.
- **Windows:** `execFileSync` on Git Bash, forward slashes in every path that crosses a boundary,
  and UTF-8 without BOM for any file another tool reads.
- **This session's own recurring mistake:** writing TypeScript test files through Python heredocs
  mangled `\n` four separate times. Use the Write/Edit tools for source files.

---

## 8. Repo state at handover

- `main` at `52152a6`, clean. No worktrees, no stray `agent/*` branch for a live ticket.
- Untracked `murlan bug/` — the owner's screenshots, predates this work, leave it.
- **#278** requeued `ready-for-agent`, claim released by hand after the `impl.summary` crash.
- **#215** open, escalated on unsettled decisions, not yet settled.
- **#350** `needs-info` — blocked on which bot personality the owner played against.
- **#320** carries the full re-measurement as a comment and is `ready-for-human`.
- Open and ready: #348, #352 (both from the owner's bug reports, both with `## Checks` sections).
- `iOS UI (Maestro)` is **red on `main`** and has been since it was added in `0d2f355`. It is not a
  required check, so `land.ts` merges past it — correct per "ci.yml is the gate", but it means that
  job currently gates nothing. See #185, #186.
