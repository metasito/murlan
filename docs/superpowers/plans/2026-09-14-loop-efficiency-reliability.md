# Loop Efficiency and Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut what a ticket costs by shedding the context the session re-reads, and close the three defects that let two pull requests land red.

**Architecture:** The loop is already a state machine derived from git and the tracker (`loop-derive.mjs`), and the supervisor already re-spawns a fresh process per ticket. This plan makes the session exit at a phase boundary so the supervisor re-spawns per *phase* — the same machine, one more transition — which drops the 200k of history phase D currently carries. Beside that, three verdicts that could be green without evidence are made to need evidence: a `LAND` needs a posted review, `agent:check` may not say `PASS` for a suite it did not run, and a ticket stranded mid-fix becomes takeable again.

**Tech Stack:** Node 24 (native type-stripping, `node --test`), `.mjs` supervisor + `.ts` tests under `tools/loop/tests/`, `gh` CLI, Claude Code `-p --output-format stream-json`.

**Spec:** `docs/research/2026-09-14-loop-efficiency.md`

## Global Constraints

- **Every figure this plan argues from is in the spec.** Do not re-derive them; `npm run loop:cost` reproduces them.
- **Do not reduce `MAX_REVIEW_ROUNDS`.** Spec §4: every round before the final one across the whole fleet was a `HOLD`, and both red pull requests are the two that issued a `LAND` with no `HOLD`. Rounds are not the waste.
- **Do not touch prompt caching, `--strict-mcp-config`, the `--tools` allowlist or the size of `queue.md`.** Spec §1: the cache hit rate is 98.9% and the fixed prefix is already minimal. Those levers are spent.
- **No self-defeating safeguards** (CLAUDE.md). Every gate added here must be unsatisfiable without the thing it guards being true; where a gate has a ceiling, name the ceiling in its docblock.
- **Comment budget is enforced at write time.** Over six comment lines (three in a test) *and* more comment than code is a refused write. Write to it; trimming afterwards has already spent a turn.
- `tools/loop/tests/**/*.test.ts` runs under `npm run loop:test` (`node --test`), never jest.
- A live loop run may be working `.worktrees/agent-<n>`. Work on a branch off `main` in the shared checkout; never edit inside a live worktree.
- Rule 40: do not park a shell inside `.worktrees/`.

---

## File Structure

No new source file is needed for seven of the eight tasks: the phase state machine, the stream parser and the supervisor already own every fact involved, and a second module holding a copy of any of them is the drift this repo has removed twice.

| File | Responsibility | Tasks |
|---|---|---|
| `tools/loop/loop-stream.mjs` | one stream line → one fact. Gains `handoff` on the declaration. | 1 |
| `tools/loop/queue-loop.mjs` | the supervisor: spawn, re-spawn, cap, record. Gains the handoff transition, the per-ticket spend ceiling, the round counter, the batching watcher. | 1, 2, 4, 8 |
| `tools/loop/claim.mjs` **(new)** | claim a ticket and stand its worktree up, as one subprocess instead of six model turns. Its own file because it is one responsibility with one entry point and is called from two places. | 3 |
| `tools/loop/loop-render.mjs` | the board. Gains the review round in the phase label and the bar. | 4 |
| `tools/loop/loop-derive.mjs` | what git and the tracker say. Gains "is there a review report for this head". | 5 |
| `tools/loop/loop-gate.mjs` | the push gate. Refuses an unbacked `LAND`. | 5 |
| `tools/loop/check-steps.mjs` | which check runs where. Unchanged list, gains the lookup `--also` needs. | 6 |
| `tools/loop/agent-check.mjs` | the pre-push verdict. Never prints a bare `PASS`. | 6 |
| `tools/loop/next-ticket.mjs` | the picker. A stranded fix round becomes takeable. | 7 |
| `.claude/commands/queue.md` | the protocol. Phase exits, the claim's new shape, the review report, the honest verdict. | 1, 3, 5, 6, 7, 8 |
| `CLAUDE.md` | the standing rules. Batching. | 8 |

---

### Task 1: The session hands off at a phase boundary

**What this buys:** ~$5.50 a ticket (spec §8). Phase D is 397 turns whose context grew 40k → 247k and is 81% of the bill; 71% of that bill is the conversation re-reading itself. A fresh process pays its 40k prefix once as a cache write (~$0.25) and starts each review round without the last one's transcript.

**Files:**
- Modify: `tools/loop/loop-stream.mjs:18-37`
- Modify: `tools/loop/queue-loop.mjs:123-133, 360-362, 1486-1603, 1748-1878`
- Modify: `.claude/commands/queue.md` (phases C, D, F)
- Test: `tools/loop/tests/streamFacts.test.ts`, `tools/loop/tests/queueLoop.test.ts`

**Interfaces:**
- Produces: `HANDOFF: RegExp` and `declaredIn`'s `handoff: string|null` from `loop-stream.mjs`; `handoffOf(run): string|null` and `MAX_HANDOFFS: number` from `queue-loop.mjs`; `runOnce` gains the return `{outcome: "handoff", ticket: number, phase: string, run: object}`.
- Consumes: `liveRoute`/`derive()`, which already compute the resume phase from commits and verdict.

- [ ] **Step 1: Write the failing test for the parsed handoff**

Append to `tools/loop/tests/streamFacts.test.ts`:

```ts
test("a declaration carries the phase it hands off at", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: 'LOOP-RESULT {"ticket":7,"phase":"C","handoff":"D"}' }] },
  });
  assert.equal(readLine(line)?.declared?.handoff, "D");
});

test("a handoff that is not a phase letter is dropped", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: 'LOOP-RESULT {"ticket":7,"handoff":"done"}' }] },
  });
  assert.equal(readLine(line)?.declared?.handoff, null);
});
```

- [ ] **Step 2: Run it and watch it fail**

```sh
node --test tools/loop/tests/streamFacts.test.ts
```

Expected: FAIL — `undefined !== 'D'`.

- [ ] **Step 3: Parse it**

In `tools/loop/loop-stream.mjs`, beside `DECLARED`:

```js
/** A handoff names the phase the next process starts at, so an unknown letter is no handoff. */
export const HANDOFF = /^[A-F]$/;
```

and in `declaredIn`'s returned object, after `phase`:

```js
      handoff: HANDOFF.test(String(d.handoff ?? "")) ? String(d.handoff) : null,
```

- [ ] **Step 4: Run it and watch it pass**

```sh
node --test tools/loop/tests/streamFacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing test for the supervisor's transition**

Append to `tools/loop/tests/queueLoop.test.ts`:

```ts
test("a handoff re-spawns the same ticket instead of parking it", async () => {
  const spawned: number[] = [];
  const io = {
    ...stubIo(),
    pick: (pinned: number | null) => ({ skill: "implement", number: pinned ?? 41, queue: null }),
    spawn: (route: { number: number }) => {
      spawned.push(route.number);
      return Promise.resolve({
        status: 0,
        ms: 1,
        log: "x",
        declared: { ticket: 41, phase: "C", handoff: "D", stoodDown: false },
      });
    },
  };
  const pass = await runOnce(io, null, 0);
  assert.equal(pass.outcome, "handoff");
  assert.equal(pass.phase, "D");
  assert.deepEqual(spawned, [41]);
});

test("a handoff cannot run for ever", () => {
  assert.equal(overHandoffs(MAX_HANDOFFS), true);
  assert.equal(overHandoffs(MAX_HANDOFFS - 1), false);
});
```

`stubIo()` is the suite's existing fake-IO helper; if it does not exist under that name, use whatever the neighbouring `runOnce` tests already build and add the two keys above.

- [ ] **Step 6: Run it and watch it fail**

```sh
node --test tools/loop/tests/queueLoop.test.ts
```

Expected: FAIL — `overHandoffs is not defined`.

- [ ] **Step 7: Make the supervisor re-spawn**

In `tools/loop/queue-loop.mjs`, beside `CI_ROUNDS`:

```js
/**
 * Processes one ticket may be spawned as. A+B+C is one, each review round is one, E+F is one — six
 * for a ticket that uses every round, and the slack is for a resume that re-enters a phase.
 *
 * A ceiling, not a budget: the thing that actually stops a runaway ticket is `overSpend`.
 */
export const MAX_HANDOFFS = 8;
export const overHandoffs = (n) => n >= MAX_HANDOFFS;

/** @param {{declared: {handoff?: string|null, stoodDown?: boolean}|null}} run */
export const handoffOf = (run) => (run.declared?.stoodDown ? null : (run.declared?.handoff ?? null));
```

In `runOnce`, immediately after `const after = afterSession(run, io.standing());`:

```js
  // Before the pull request is looked for: a session that handed off has not pushed and is not
  // finished, and every reading below is about a session that meant to be its ticket's last.
  const handoff = handoffOf(run);
  if (handoff) {
    io.record({ number: route.number, outcome: "handoff", why: `phase ${handoff} next`, run, counts: false });
    return { outcome: "handoff", ticket: route.number, phase: handoff, run };
  }
```

In `nextRoute`, so a pinned handoff starts where the session said rather than where `derive` guesses:

```js
function nextRoute(pinned = null, at = null) {
  const live = liveRoute(derive());
  if (live) return { ...live, phase: at ?? live.phase, size: ticketFacts(live.number).size, queue: null };
```

and in `realIo`, `pick: (pinned, at) => { const route = nextRoute(pinned, at); ... }`, with `runOnce` calling `io.pick(pinned, at)` — `at` threaded in as `runOnce(io, pinned, roundsUsed, at)`.

In `main`, beside the `retry` branch:

```js
    if (pass.outcome === "handoff") {
      handoffs = pass.ticket === pinned ? handoffs + 1 : 1;
      pinned = pass.ticket;
      nextPhase = pass.phase;
      if (overHandoffs(handoffs)) {
        io.park(pinned, { phase: pass.phase, why: `${handoffs} phase handoffs on one ticket`, log: pass.run.log, cwd: null, branch: null, dirty: false });
        pinned = null;
        nextPhase = null;
        failures += 1;
        if (shouldHalt(failures)) return finish(1, `${failures} tickets in a row did not land`);
        continue;
      }
      continue;
    }
```

with `let handoffs = 0;` and `let nextPhase = null;` declared beside `rounds`, both cleared wherever `pinned = null` already is, and `runOnce(watched, pinned, rounds, nextPhase)` at the call site.

Add to `loop-render.mjs`'s `OUTCOME` map so the row is not an anonymous dot:

```js
  handoff: ["→", "muted"],
```

- [ ] **Step 8: Run it and watch it pass**

```sh
node --test tools/loop/tests/queueLoop.test.ts
```

Expected: PASS.

- [ ] **Step 9: Teach the protocol to exit at the boundary**

In `.claude/commands/queue.md`, at the end of **C — Build**, after the turn-budget paragraph:

```markdown
**Then stop.** Commit the last slice, say what you did, and exit:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"C","handoff":"D"}
```

The supervisor starts phase D in a fresh process, which is the point: review is 81% of a ticket's
cost and most of that is this conversation being re-read on every one of its turns. Your worktree
stays standing and the next process finds it from git. Do not review your own build here.
```

At the end of **D — Review**, after the cap paragraph and before **E — Land**:

```markdown
**A round is a process.** When you post a `HOLD`, fix what it named, commit, and hand off — the
re-review is a fresh reader of a new head, and it must not inherit this round's transcript:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"D","handoff":"D"}
```

When you post a `LAND`, hand off to E the same way, with `"handoff":"E"`.
```

In **F — Close out** step 5, after "Omit `pr` only if you genuinely pushed none.":

```markdown
   `handoff` is the opposite of this line's usual job: with it, you are saying the ticket is *not*
   finished and which phase takes it next. Phase F never sets it — this is the ticket's last process.
```

- [ ] **Step 10: Verify end to end and commit**

```sh
npm run loop:test
npx tsc --noEmit
npx eslint tools/loop
git add -- tools/loop/loop-stream.mjs tools/loop/queue-loop.mjs tools/loop/loop-render.mjs tools/loop/tests .claude/commands/queue.md
git commit -m "Start each phase in its own process, so review stops paying for the build"
```

---

### Task 2: A ticket's spend is capped across its processes

**What this buys:** Task 1 turns one `--max-budget-usd 40` session into up to eight of them, which is a $320 ceiling where there was a $40 one. The measured tail is real: #1043 hit $25.11 on a `size:S` whose fleet median is $17.67 (spec §5).

**Files:**
- Modify: `tools/loop/queue-loop.mjs:141-152, 1486-1603, 1748-1878`
- Test: `tools/loop/tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `runOnce`'s `{outcome: "handoff", run}` from Task 1; `run.result.cost`, which the stream already carries.
- Produces: `USD_BY_SIZE: Record<string, number>`, `USD_DEFAULT: number`, `overSpend(spent, size): boolean` from `queue-loop.mjs`.

- [ ] **Step 1: Write the failing test**

Append to `tools/loop/tests/queueLoop.test.ts`:

```ts
test("a ticket's ceiling is its size's, and an unlabelled one gets the default", () => {
  assert.equal(overSpend(5, "size:S"), false);
  assert.equal(overSpend(USD_BY_SIZE["size:S"], "size:S"), true);
  assert.equal(overSpend(USD_DEFAULT, null), true);
});

test("every size's ceiling is above the fleet median it is meant to bound", () => {
  for (const [size, cap] of Object.entries(USD_BY_SIZE)) {
    assert.ok(cap >= 20, `${size} at $${cap} would park a healthy ticket`);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```sh
node --test tools/loop/tests/queueLoop.test.ts
```

Expected: FAIL — `overSpend is not defined`.

- [ ] **Step 3: Add the ceiling**

In `tools/loop/queue-loop.mjs`, beside `TURNS_BY_SIZE`:

```js
/**
 * What one ticket may cost across every process it is spawned as.
 *
 * `TICKET_BUDGET_USD` bounds a single session and is unchanged; with phase handoffs a ticket is up
 * to `MAX_HANDOFFS` of them, so the per-ticket figure has to be kept here, where the supervisor is
 * the only thing that survives them all. Set above the fleet median for the size
 * (`docs/research/2026-09-14-loop-efficiency.md` §5), so it catches a runaway and never a healthy run.
 */
export const USD_BY_SIZE = {
  "size:XS": 20,
  "size:S": 30,
  "size:M": 45,
  "size:L": 70,
  "size:XL": 90,
};
export const USD_DEFAULT = 40;

/** @param {number} spent @param {string|null} size */
export const overSpend = (spent, size) => spent >= (USD_BY_SIZE[size ?? ""] ?? USD_DEFAULT);
```

- [ ] **Step 4: Run it and watch it pass**

```sh
node --test tools/loop/tests/queueLoop.test.ts
```

Expected: PASS.

- [ ] **Step 5: Spend it**

In `main`, beside `handoffs`:

```js
  /** What the pinned ticket has cost across every process it has been spawned as. */
  let spent = 0;
```

In the `handoff` branch added by Task 1, before the ceiling check:

```js
      spent = pass.ticket === pinned ? spent + (pass.run.result?.cost ?? 0) : (pass.run.result?.cost ?? 0);
      if (overSpend(spent, pass.run.size ?? null)) {
        io.bell();
        io.park(pass.ticket, {
          phase: pass.phase,
          why: `$${spent.toFixed(2)} across ${handoffs + 1} processes — over this ticket's ceiling`,
          log: pass.run.log, cwd: null, branch: null, dirty: false,
        });
        pinned = null; nextPhase = null; handoffs = 0; spent = 0;
        failures += 1;
        if (shouldHalt(failures)) return finish(1, `${failures} tickets in a row did not land`);
        continue;
      }
```

Reset `spent = 0` everywhere `pinned = null` already is. Carry the size onto the run: in `runTicket`'s resolve object add `size,` (it is already a parameter).

- [ ] **Step 6: Verify and commit**

```sh
npm run loop:test
npx tsc --noEmit
git add -- tools/loop/queue-loop.mjs tools/loop/tests/queueLoop.test.ts
git commit -m "Bound what one ticket may cost across every process it is spawned as"
```

---

### Task 3: The supervisor claims the ticket and stands the worktree up

**What this buys:** Phase A is 17 turns and 1.2 median minutes (spec §3) for work that is entirely mechanical — one label, one comment, one re-read, one fetch, one `worktree add`. Each is a model turn with a full context read behind it (~$0.07, spec §2). A subprocess does the six of them in about a second and cannot mis-quote a backtick in PowerShell, which is a failure mode `queue.md` currently carries three paragraphs of prose about.

**Files:**
- Create: `tools/loop/claim.mjs`
- Modify: `tools/loop/queue-loop.mjs` (`realIo.spawn`)
- Modify: `.claude/commands/queue.md` (phase A)
- Modify: `package.json` (`scripts`)
- Test: `tools/loop/tests/claim.test.ts`

**Interfaces:**
- Produces: `slugOf(title): string`, `claimSteps(number, title): {name: string, file: string, args: string[]}[]`, and `claim(number, title, run?): {branch: string, cwd: string, won: boolean, why: string|null}` from `tools/loop/claim.mjs`.
- Consumes: `REPO` and `WORKTREE_DIR` from `loop-derive.mjs`.

- [ ] **Step 1: Write the failing test**

Create `tools/loop/tests/claim.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { slugOf, claimSteps, claim } from "../claim.mjs";

test("a slug is lowercase, hyphenated and short enough to be a branch", () => {
  assert.equal(slugOf("Fix the A11y veil's re-announce"), "fix-the-a11y-veil-s-re-announce");
  assert.ok(slugOf("x".repeat(200)).length <= 48);
});

test("the claim writes the label before it reads the race", () => {
  const names = claimSteps(42, "Some ticket").map((s) => s.name);
  assert.deepEqual(names, ["label", "comment", "race", "fetch", "worktree"]);
});

test("the claim comment goes through a file, never an inline body", () => {
  const comment = claimSteps(42, "Some ticket").find((s) => s.name === "comment");
  assert.ok(comment?.args.includes("--body-file"));
  assert.ok(!comment?.args.includes("--body"));
});

test("an older claim by someone else loses the race", () => {
  const out = claim(42, "Some ticket", (file: string, args: string[]) => {
    if (args.includes("--json")) {
      return JSON.stringify({ comments: [{ body: "Claimed by `agent/42-someone-else`." }] });
    }
    return "";
  });
  assert.equal(out.won, false);
  assert.match(String(out.why), /agent\/42-someone-else/);
});
```

- [ ] **Step 2: Run it and watch it fail**

```sh
node --test tools/loop/tests/claim.test.ts
```

Expected: FAIL — cannot find module `../claim.mjs`.

- [ ] **Step 3: Write it**

Create `tools/loop/claim.mjs`:

```js
/**
 * Claims a ticket and stands its worktree up, as one subprocess.
 *
 * Six `gh` and `git` calls that need no judgement were six model turns of phase A, each paying a
 * full context read; and the claim comment's backticks are what `next-ticket.mjs` matches a peer's
 * claim on, which PowerShell turns into a BEL when a model writes it inline.
 *
 * Usage: node tools/loop/claim.mjs <n> "<title>"
 *        exit 0 - claimed, worktree standing; exit 1 - lost the race, or could not
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKTREE_DIR } from "./loop-derive.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const SLUG_MAX = 48;

export function slugOf(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-$/, "");
}

/**
 * The steps, in the one order that makes the race check mean anything: the label is the write, and
 * the read that decides who won has to come after it.
 */
export function claimSteps(number, title, noteFile = "") {
  const branch = `agent/${number}-${slugOf(title)}`;
  return [
    { name: "label", file: "gh", args: ["issue", "edit", String(number), "--add-label", "in-progress"] },
    { name: "comment", file: "gh", args: ["issue", "comment", String(number), "--body-file", noteFile] },
    { name: "race", file: "gh", args: ["issue", "view", String(number), "--json", "comments"] },
    { name: "fetch", file: "git", args: ["fetch", "origin", "--quiet"] },
    { name: "worktree", file: "git", args: ["worktree", "add", "-b", branch, `${WORKTREE_DIR}/agent-${number}`, "origin/main"] },
  ];
}

/** Every claim comment on the thread, by the branch it names. A fresh one per read: `g` is stateful. */
const claims = () => /Claimed by `(agent\/\d+-[^`]*)`/g;

export function claim(number, title, run = (file, args) => execFileSync(file, args, { encoding: "utf8" })) {
  const branch = `agent/${number}-${slugOf(title)}`;
  const cwd = `${WORKTREE_DIR}/agent-${number}`;
  const noteFile = join(mkdtempSync(join(tmpdir(), "claim-")), "claim.md");
  writeFileSync(noteFile, `Claimed by \`${branch}\`.\n`, "utf8");

  for (const step of claimSteps(number, title, noteFile)) {
    const out = run(step.file, step.args);
    if (step.name !== "race") continue;
    const mine = [...String(out).matchAll(claims())].map((m) => m[1]).filter((b) => b !== branch);
    if (mine.length) {
      run("gh", ["issue", "edit", String(number), "--remove-label", "in-progress"]);
      return { branch, cwd, won: false, why: `${mine[0]} claimed it first` };
    }
  }
  return { branch, cwd, won: true, why: null };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [n, title] = process.argv.slice(2);
  const out = claim(Number(n), title ?? `ticket ${n}`);
  console.log(`CLAIM\t${out.won ? "won" : "lost"}\t${out.branch}\t${out.cwd}\t${out.why ?? ""}`);
  process.exit(out.won ? 0 : 1);
}
```

- [ ] **Step 4: Run it and watch it pass**

```sh
node --test tools/loop/tests/claim.test.ts
```

Expected: PASS.

- [ ] **Step 5: Call it from the supervisor**

In `realIo.spawn`, before `runTicket`, for a route that is not resuming:

```js
    spawn: (route) => {
      if (!route.resuming) {
        screen.say(`  · picking — ${route.queue?.implement ?? 0} takeable`);
        const claimed = sh("node", [HERE + "/claim.mjs", String(route.number), route.title]);
        screen.say(stepRow({ label: "claim", detail: claimed.split("\t").slice(1, 3).join(" "), ms: null }, screen.theme));
      }
```

Wrap it so a lost race is a stand-down rather than a throw: on a non-zero exit `sh` throws, and the catch records the ticket as `parked` with the race as its reason, returning without spawning.

Add to `package.json` `scripts`:

```json
    "queue:claim": "node tools/loop/claim.mjs",
```

- [ ] **Step 6: Cut phase A down to what needs judgement**

In `.claude/commands/queue.md`, replace the block from "Claim it as the first write, before any code:" through "Never change the shared checkout's branch." with:

```markdown
**The claim and the worktree are already done.** The supervisor ran `tools/loop/claim.mjs` before it
spawned you: the `in-progress` label, the claim comment, the race check against a peer, the fetch and
`git worktree add -b agent/<n>-<slug> .worktrees/agent-<n> origin/main`. `loop-status.mjs` above
named the worktree; work only in it, and never change the shared checkout's branch. A by-hand
`/queue` does the same with `npm run queue:claim -- <n> "<title>"`.

None of that needed a judgement, and as six model turns it was 17 turns and 1.2 minutes of phase A
for work a subprocess does in a second.
```

Leave the "Post the ticket's Definition of done" paragraph exactly as it is — that is the one part of phase A that is a judgement.

- [ ] **Step 7: Verify and commit**

```sh
npm run loop:test
npx tsc --noEmit
npx eslint tools/loop
git add -- tools/loop/claim.mjs tools/loop/tests/claim.test.ts tools/loop/queue-loop.mjs package.json .claude/commands/queue.md
git commit -m "Claim the ticket and stand its worktree up in a subprocess, not in six model turns"
```

---

### Task 4: The board names the review round

**What this buys:** review is 81% of a ticket and the board says only "review" for all of it. With Task 1 each round is its own process, so the supervisor knows exactly which one it is — the number is free.

**Files:**
- Modify: `tools/loop/loop-render.mjs:302-306, 382-396`
- Modify: `tools/loop/queue-loop.mjs` (`runTicket`, `ticker`)
- Test: `tools/loop/tests/render.test.ts`

**Interfaces:**
- Consumes: `ticketFacts(number).reviewRounds`, which already exists and is already read per ticket; `MAX_REVIEW_ROUNDS` from `loop-gate.mjs`.
- Produces: `phaseRow` and `progress` both accept an optional `round: {n: number, of: number}|null`.

- [ ] **Step 1: Write the failing test**

Append to `tools/loop/tests/render.test.ts`:

```ts
test("the bar names which review round it is", () => {
  const t = PLAIN(80);
  assert.match(progress({ letter: "D", ms: 0, round: { n: 2, of: 4 } }, t), /review 2\/4/);
});

test("a phase with no round reads exactly as it did", () => {
  const t = PLAIN(80);
  assert.match(progress({ letter: "C", ms: 0 }, t), /build/);
  assert.doesNotMatch(progress({ letter: "C", ms: 0 }, t), /\//);
});

test("a finished review round keeps its number in the scrollback", () => {
  const t = PLAIN(80);
  assert.match(phaseRow({ letter: "D", ms: 1000, round: { n: 3, of: 4 } }, t), /review 3\/4/);
});
```

- [ ] **Step 2: Run it and watch it fail**

```sh
node --test tools/loop/tests/render.test.ts
```

Expected: FAIL — no `2/4` in the output.

- [ ] **Step 3: Render it**

In `tools/loop/loop-render.mjs`, beside `PHASES`:

```js
/** "review 2/4" where there is a round to name, else the plain label. */
const labelFor = (letter, round) => {
  const at = PHASES.findIndex(([l]) => l === letter);
  const name = at >= 0 ? PHASES[at][1] : letter;
  return round ? `${name} ${round.n}/${round.of}` : name;
};
```

`phaseRow` becomes:

```js
export function phaseRow({ letter, detail = "", ms, state = "done", round = null }, t) {
  return stepRow({ label: labelFor(letter, round), detail, ms, state }, t);
}
```

and in `progress`, replace the `name` line — widening `LABEL` from 8 to 12, since "review 2/4" is ten columns and the slot is fixed so the bar's right edge does not move:

```js
  const name = clamp(known ? labelFor(letter, round) : "no phase", LABEL).padEnd(LABEL);
```

with `round = null` added to `progress`'s destructured parameter and `LABEL` set to `12`.

- [ ] **Step 4: Run it and watch it pass**

```sh
node --test tools/loop/tests/render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Feed it the number**

In `tools/loop/queue-loop.mjs`, `ticker`'s `start` takes the round and keeps it on `open`:

```js
    start(letter, round = null) {
      ...
      open = { letter, round, startedAt: Date.now(), said: null, recent: [], feed: [] };
```

`block()` passes `round: open.round` into `progress`, and `close()` passes it into `phaseRow`.

In `runTicket`, the round comes from the facts already read for the header:

```js
  // `reviewRounds` counts the verdicts already on the issue, so the round about to run is the next
  // one. Null when the tracker could not be read — a number nobody could take is not a count of none.
  const round = () =>
    state.phase === "D" && about.reviewRounds != null
      ? { n: about.reviewRounds + 1, of: MAX_REVIEW_ROUNDS }
      : null;
```

called at each `screen.start(fact.letter, round())` — set `state.phase` before calling it — and imported: `import { MAX_REVIEW_ROUNDS } from "./loop-gate.mjs";`.

- [ ] **Step 6: Re-pace the bar for a split phase D**

`PHASE_MINUTES.D = 26` was measured on a phase D that ran all its rounds in one process. With Task 1 each round is its own process and phase D's row is one round, so the median is a round, not the phase. Set it from the data rather than guessing:

```sh
npm run loop:cost
```

Take phase D's median minutes, divide by the median review rounds the same output prints, and write that as `PHASE_MINUTES.D`. Leave the docblock above it telling the next reader to re-derive it the same way.

- [ ] **Step 7: Verify and commit**

```sh
npm run loop:test
npx tsc --noEmit
git add -- tools/loop/loop-render.mjs tools/loop/queue-loop.mjs tools/loop/tests/render.test.ts
git commit -m "Say which review round the board is showing"
```

---

### Task 5: A `LAND` is refused unless the review that backs it is on the issue

**What this buys:** the single biggest reliability defect measured. #1043 spawned eight reviewer subagents over four rounds, spent $20.26, and posted exactly one comment: `VERDICT: LAND`. The review ran and bound nothing, and the branch went out red. Both red pull requests in the fleet are the two that LANDed with no HOLD ever recorded (spec §4, §6).

`queue.md` already instructs "Post both reports on the issue, under `## Standards` and `## Spec`". Nothing reads that, so nothing happens when it does not.

**Files:**
- Modify: `tools/loop/loop-derive.mjs:34-35, 142-170, 260-297`
- Modify: `tools/loop/loop-gate.mjs:98-113`
- Modify: `.claude/commands/queue.md` (phase D)
- Test: `tools/loop/tests/loopDerive.test.ts`, `tools/loop/tests/loopGate.test.ts`

**Interfaces:**
- Produces: `REVIEW_RE: RegExp` and `reviewFor(comments, head): {line: string}|null` from `loop-derive.mjs`; `derive()` gains `review: {line: string}|null` and `why` gains the unbacked-LAND sentence.
- Consumes: `verdictFor`'s existing `covers(sha)` shape, reused so the two cannot disagree about what "this head" means.

- [ ] **Step 1: Write the failing test**

Append to `tools/loop/tests/loopDerive.test.ts`:

```ts
const report = (sha: string) =>
  `REVIEW ${sha}\n\n## Standards\n\nNothing that affects correctness.\n\n## Spec\n\nEvery box closed.`;

test("a review report is found for the head it names", () => {
  assert.ok(reviewFor([{ body: report("abc1234") }], "abc1234def"));
});

test("a review of an earlier head does not cover this one", () => {
  assert.equal(reviewFor([{ body: report("0000000") }], "abc1234def"), null);
});

test("a report missing an axis is not a review", () => {
  assert.equal(reviewFor([{ body: "REVIEW abc1234\n\n## Standards\n\nfine." }], "abc1234def"), null);
});

test("a report inside a code fence is not a review", () => {
  assert.equal(reviewFor([{ body: "```\n" + report("abc1234") + "\n```" }], "abc1234def"), null);
});
```

Append to `tools/loop/tests/loopGate.test.ts`:

```ts
test("a LAND with no review report on the issue is refused", () => {
  const s = { onTicket: true, ticket: 1, phase: "E", commits: 1, changed: ["a.ts"], head: "abc1234def",
    base: "origin/main", cwd: ".", trackerReadable: true,
    verdict: { decision: "LAND", line: "VERDICT: LAND abc1234" }, review: null, reviewRounds: 1 };
  assert.equal(pushVerdict(s).ok, false);
  assert.match(String(pushVerdict(s).why), /no review report/);
});

test("a LAND backed by a report for the same head passes", () => {
  const s = { onTicket: true, ticket: 1, phase: "E", commits: 1, changed: ["a.ts"], head: "abc1234def",
    base: "origin/main", cwd: ".", trackerReadable: true,
    verdict: { decision: "LAND", line: "VERDICT: LAND abc1234" },
    review: { line: "REVIEW abc1234" }, reviewRounds: 1 };
  assert.equal(pushVerdict(s).ok, true);
});
```

- [ ] **Step 2: Run them and watch them fail**

```sh
node --test tools/loop/tests/loopDerive.test.ts tools/loop/tests/loopGate.test.ts
```

Expected: FAIL — `reviewFor is not defined`, `pushVerdict is not defined`.

- [ ] **Step 3: Read the report**

In `tools/loop/loop-derive.mjs`, beside `VERDICT_RE`:

```js
/** The review's own comment, naming the head it read. The same sha binding the verdict carries. */
const REVIEW_RE = /^REVIEW\s+([0-9a-f]{7,40})\b/m;
```

and beside `verdictFor`:

```js
/**
 * The review reports for this head, which is what makes a `LAND` mean anything.
 *
 * #1043 spent $20.26 over four review rounds and posted one comment — `VERDICT: LAND` — and went out
 * red. The reports had been written; they reached nothing that could refuse the push.
 *
 * Both axis headings are required because `queue.md` posts both and a change can pass one and fail
 * the other. **Its ceiling, stated: a comment carrying both headings and no findings satisfies this.**
 * It is a check against omission, which is the measured failure, not against a forged report.
 *
 * @param {{body: string}[]} comments
 * @param {string} head
 */
export function reviewFor(comments, head) {
  const short = head.slice(0, 7);
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = fenceStripped(comments[i].body);
    const m = REVIEW_RE.exec(body);
    if (!m || !(head.startsWith(m[1]) || m[1].startsWith(short))) continue;
    if (!/^##\s+Standards\s*$/m.test(body) || !/^##\s+Spec\s*$/m.test(body)) continue;
    return { line: m[0].trim() };
  }
  return null;
}
```

In `derive()`'s returned object, beside `verdict`:

```js
    review: trackerReadable ? reviewFor(comments, head) : null,
```

- [ ] **Step 4: Refuse on it**

In `tools/loop/loop-gate.mjs`, lift the push decision out of `main`'s console writing so a test can drive it:

```js
/**
 * Whether this head may be pushed. Fails closed on every unknown: an unreachable tracker is not a
 * review, a verdict on an older commit is not this diff's, and a `LAND` with no report behind it is
 * the shape that put two red branches on origin.
 *
 * @param {ReturnType<import("./loop-derive.mjs").derive>} s
 * @returns {{ok: boolean, why?: string, lines?: string[]}}
 */
export function pushVerdict(s) {
  if (s.commits === 0 || s.changed.length === 0)
    return { ok: false, why: "nothing was built on this branch", lines: [
      `${s.commits} commit(s), ${s.changed.length} changed file(s) against ${s.base} in ${s.cwd}`,
      "Phase C commits each slice as it lands.",
    ] };
  if (!s.trackerReadable) return { ok: false, why: `cannot reach the tracker to read the review of #${s.ticket}` };
  if (!s.verdict) return { ok: false, why: `no review of ${s.head.slice(0, 7)} on the issue`, lines: [
    "Phase D posts the reviewer's verdict as a comment on the issue, naming the commit it read:",
    `  VERDICT: LAND ${s.head.slice(0, 7)}   (or VERDICT: HOLD ${s.head.slice(0, 7)} — reason)`,
    "A commit made after a review moves the head, so that review no longer covers this diff.",
  ] };
  if (s.verdict.decision !== "LAND") return { ok: false, why: "the reviewer held this diff", lines: [s.verdict.line] };
  if (!s.review) return { ok: false, why: `no review report for ${s.head.slice(0, 7)} on the issue`, lines: [
    "A verdict is the session's read of two reports, and those reports are the record. Post them",
    "as their own comment before the verdict, first line the head they read:",
    `  REVIEW ${s.head.slice(0, 7)}`,
    "then `## Standards` and `## Spec`, unmerged. A LAND with nothing behind it is what put two",
    "red branches on origin.",
  ] };
  return { ok: true };
}
```

`main` calls it and keeps its existing `refuse()` formatting; the `trackerReadable` branch keeps returning 2 rather than 1.

- [ ] **Step 5: Run them and watch them pass**

```sh
node --test tools/loop/tests/loopDerive.test.ts tools/loop/tests/loopGate.test.ts
```

Expected: PASS.

- [ ] **Step 6: Teach the protocol the report's shape**

In `.claude/commands/queue.md`, phase D, replace "Post both reports on the issue, under `## Standards` and `## Spec`, unmerged — the skill's own rule, because a change can pass one axis and fail the other." with:

```markdown
Post both reports as one comment on the issue, unmerged — the skill's own rule, because a change can
pass one axis and fail the other. Its first line names the head they read, and the two headings are
exactly `## Standards` and `## Spec`:

```
REVIEW <sha>

## Standards
...
## Spec
...
```

`loop-gate.mjs` refuses a `VERDICT: LAND` for a head with no `REVIEW` comment behind it. #1043 spent
$20.26 over four rounds and posted one line — `VERDICT: LAND` — and the branch went out red; the
reports existed and reached nothing that could stop it.
```

- [ ] **Step 7: Verify and commit**

```sh
npm run loop:test
npx tsc --noEmit
npx eslint tools/loop
git add -- tools/loop/loop-derive.mjs tools/loop/loop-gate.mjs tools/loop/tests .claude/commands/queue.md
git commit -m "Refuse a LAND that has no review behind it"
```

---

### Task 6: `agent:check` never says PASS for a suite it did not run

**What this buys:** #1043's own verdict block read `agent:check PASS (tree e8b1e870)` having run three of eight steps. The failing test was `tests/sourceScan.test.ts`, inside `npm test`, which the block listed under `ci.yml verify:` without running. The word the session acted on was `PASS` (spec §6).

`queue.md` anticipates this in prose — "a green line standing for a suite nobody ran is not a pass" — which is a sentence, and a sentence cannot fail.

**Non-goal, stated:** moving `test` from `ci` to `local`. `npm test` runs behind `scripts/preflightMemory.mjs`, which refuses while peers are running, and the owner's standing workflow is that CI is the test runner. This task makes the verdict honest and gives a fix round a way to run the one suite CI named; it does not move the gate.

**Files:**
- Modify: `tools/loop/check-steps.mjs:17-21`
- Modify: `tools/loop/agent-check.mjs:22-31, 113-152`
- Modify: `.claude/commands/queue.md` (phase E)
- Test: `tools/loop/tests/agentCheckDelegation.test.ts`

**Interfaces:**
- Produces: `byName(name): step|undefined` from `check-steps.mjs`; `agent-check.mjs` accepts `--also <name>`.
- Consumes: the existing `STEPS`/`LOCAL`/`DELEGATED` split, unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tools/loop/tests/agentCheckDelegation.test.ts`:

```ts
import { readFileSync } from "node:fs";

test("the verdict never prints a bare PASS", () => {
  const src = readFileSync(new URL("../agent-check.mjs", import.meta.url), "utf8");
  for (const m of src.matchAll(/["'`][^"'`]*\bPASS\b[^"'`]*["'`]/g)) {
    assert.match(m[0], /LOCAL PASS/, `${m[0]} is a pass a reader will take for the whole suite`);
  }
});

test("the verdict says how many suites it did not run", () => {
  assert.ok(DELEGATED.length > 0);
  assert.equal(byName("test")?.where, "ci");
  assert.equal(byName("lint")?.where, "local");
  assert.equal(byName("nope"), undefined);
});
```

- [ ] **Step 2: Run it and watch it fail**

```sh
node --test tools/loop/tests/agentCheckDelegation.test.ts
```

Expected: FAIL — `byName is not defined`, and the bare `PASS` strings.

- [ ] **Step 3: Make it honest**

In `tools/loop/check-steps.mjs`:

```js
export const byName = (name) => STEPS.find((s) => s.name === name);
```

In `tools/loop/agent-check.mjs`, `verdict` gains the count and the headline is scoped:

```js
const verdict = (outcome) =>
  [
    outcome,
    `  judged:    ${subject.root} against origin/main@${subject.base}`,
    `  ran here:  ${LOCAL.map((s) => s.name).join(", ")}`,
    `  NOT run:   ${DELEGATED.length} suite(s) — a green line here stands for none of them`,
    ...DELEGATED.map((s) => `  ci.yml ${s.job}:  ${cmd(s)}`),
  ].join("\n");
```

and the three call sites become `LOCAL PASS`:

```js
  console.log(verdict(`agent:check  CACHED LOCAL PASS for tree ${key} (${cache[key].at})`));
...
console.log(verdict(`\nagent:check  LOCAL PASS  (tree ${key}) — ${LOCAL.length} of ${STEPS.length} suites`));
```

with `STEPS` added to the import.

- [ ] **Step 4: Let a fix round run the suite CI named**

In `tools/loop/agent-check.mjs`, after `const force = ...`:

```js
// A red CI round knows which suite failed, and running only that one here is the difference between
// fixing it and pushing again to find out. Named, never a wildcard: `--also` picking up every
// delegated step is `npm run verify` with a memory preflight this machine refuses.
const also = process.argv.indexOf("--also");
const extra = also >= 0 ? [byName(process.argv[also + 1])].filter(Boolean) : [];
```

and iterate `[...LOCAL, ...extra]` in the step loop, with `extra` named in the verdict's `ran here:` line and excluded from the cache key so a `--also` pass cannot replay as a plain one:

```js
const key = treeHash() + (extra.length ? `+${extra.map((s) => s.name).join(",")}` : "");
```

- [ ] **Step 5: Run it and watch it pass**

```sh
node --test tools/loop/tests/agentCheckDelegation.test.ts
npm run agent:check
```

Expected: PASS, and the printed verdict reads `LOCAL PASS` with a `NOT run:` line.

- [ ] **Step 6: Teach the protocol to read it**

In `.claude/commands/queue.md`, phase E, replace "Say what it reported, including the checks it names as CI's — a green line standing for a suite nobody ran is not a pass." with:

```markdown
Its headline is `LOCAL PASS`, never `PASS`, and it prints how many suites it did not run. Say both
numbers in the pull request body. CI is the gate; this is a filter in front of it, and #1043 read a
`PASS` that stood for three of eight steps and pushed a branch whose `npm test` was red.

On a fix round, run the suite CI actually named as well:

```sh
npm run agent:check -- --also test        # or loop:test, test:native, comments
```
```

- [ ] **Step 7: Verify and commit**

```sh
npm run loop:test
npx tsc --noEmit
git add -- tools/loop/check-steps.mjs tools/loop/agent-check.mjs tools/loop/tests/agentCheckDelegation.test.ts .claude/commands/queue.md
git commit -m "Never call a run of three suites in eight a pass"
```

---

### Task 7: A ticket stranded mid-fix is takeable again

**What this buys:** #1043 carries `in-progress`, an open red pull request and an unread `ci-1043.log`, and no future loop will take it. The red-CI fix round is handed back in memory by the supervisor that saw it; `next-ticket.mjs:53` skips every `in-progress` ticket, so a supervisor that died between rounds strands the ticket for good (spec §6).

**Files:**
- Modify: `tools/loop/next-ticket.mjs:48-62, 109-117`
- Modify: `.claude/commands/queue.md` (phase A, fix round)
- Test: `tools/loop/tests/nextTicket.test.ts`

**Interfaces:**
- Produces: `stranded(issue, {openPr, liveWorktree}): boolean` from `next-ticket.mjs`; `classify(openIssues, io?)` gains an optional IO object so the test drives it without `gh` or git.
- Consumes: `worktrees()` from `loop-derive.mjs`, `openPrsFor` already in this file.

- [ ] **Step 1: Write the failing test**

Append to `tools/loop/tests/nextTicket.test.ts`:

```ts
const inProgress = { number: 1043, title: "t", labels: [{ name: "in-progress" }, { name: "ready-for-agent" }] };

test("an in-progress ticket with an open PR and no live worktree is stranded", () => {
  assert.equal(stranded(inProgress, { openPr: true, liveWorktree: false }), true);
});

test("an in-progress ticket whose worktree is standing belongs to a live run", () => {
  assert.equal(stranded(inProgress, { openPr: true, liveWorktree: true }), false);
});

test("an in-progress ticket that never pushed is mid-build, not stranded", () => {
  assert.equal(stranded(inProgress, { openPr: false, liveWorktree: false }), false);
});

test("a stranded ticket reaches the frontier ahead of fresh work", () => {
  const fresh = { number: 1100, title: "u", labels: [{ name: "ready-for-agent" }] };
  const io = { openPr: (n: number) => n === 1043, liveWorktrees: () => new Set<number>() };
  assert.deepEqual(classify([fresh, inProgress], io).frontier.map((i) => i.number), [1043, 1100]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```sh
node --test tools/loop/tests/nextTicket.test.ts
```

Expected: FAIL — `stranded is not defined`.

- [ ] **Step 3: Let it through**

In `tools/loop/next-ticket.mjs`:

```js
/**
 * A ticket whose supervisor died between CI rounds.
 *
 * A red round is handed back in the supervisor's own memory, so a fresh one runs the picker — which
 * skips `in-progress` — and #1043 now holds a claim, an open red pull request and a log nothing will
 * read. The three facts together are the whole test: claimed, pushed, and no worktree on this
 * machine standing for it.
 *
 * The worktree half is local by design. This loop runs on one machine, and `.worktrees/` is the only
 * evidence that separates "a peer is working it right now" from "nobody is", which is the one
 * distinction that must not be got wrong in the direction of taking a live ticket.
 */
export function stranded(issue, { openPr, liveWorktree }) {
  return labelNames(issue).includes("in-progress") && openPr && !liveWorktree;
}
```

`classify` gains the IO and the branch:

```js
export function classify(openIssues, io = realClassifyIo()) {
  const live = io.liveWorktrees();
  const buckets = { frontier: [], triage: [], wayfinder: [], owner: [], stranded: [] };
  for (const issue of openIssues) {
    const ls = labelNames(issue);
    if (ls.includes("in-progress")) {
      // `live === null` is git unreadable: every ticket reads as live, which fails closed.
      if (stranded(issue, { openPr: io.openPr(issue.number), liveWorktree: !live || live.has(issue.number) })) {
        buckets.stranded.push(issue);
      }
      continue;
    }
    if (ls.includes("blocked")) continue;
    buckets[BUCKET[routeOf(issue)] ?? "owner"].push(issue);
  }
  for (const b of [...Object.values(BUCKET), "stranded"]) buckets[b].sort((a, x) => a.number - x.number);
  // A branch already pushed and already reviewed is the cheapest work in the queue, and leaving it
  // is the one outcome nothing else recovers from.
  buckets.frontier = [...buckets.stranded, ...buckets.frontier];
  return buckets;
}

function realClassifyIo() {
  return {
    openPr: (n) => openPrsFor(n).some((pr) => pr.state === "OPEN"),
    liveWorktrees: () => {
      try {
        return new Set(worktrees().map((w) => ticketOf(w.branch)).filter(Boolean));
      } catch {
        // Unreadable git is not evidence that nothing is running — but an empty set says every
        // ticket is stranded, so refuse instead: `stranded` is asked with liveWorktree true.
        return null;
      }
    },
  };
}
```

with `import { BRANCH, ticketOf, worktrees } from "./loop-derive.mjs";`.

`takeable()` must not then refuse it: `claimedElsewhere` rejects a ticket with an open pull request, which is exactly the stranded shape. Skip that check for a stranded candidate:

```js
    if (!stranded(issue, { openPr: true, liveWorktree: false }) && claimedElsewhere(issue.number, openPrsFor)) {
```

— read from the issue's own labels, so only an `in-progress` candidate takes the exemption.

- [ ] **Step 4: Run it and watch it pass**

```sh
node --test tools/loop/tests/nextTicket.test.ts
```

Expected: PASS.

- [ ] **Step 5: Let phase A read CI when the log is gone**

In `.claude/commands/queue.md`, phase A's fix-round block, replace `cat .loop-logs/ci-<n>.log` with:

```sh
cat .loop-logs/ci-<n>.log 2>/dev/null \
  || gh run list --branch agent/<n>-<slug> --limit 1 --json databaseId --jq '.[0].databaseId' \
     | xargs -I{} gh run view {} --log-failed
```

and add:

```markdown
The log file is this machine's and the supervisor that wrote it may be gone — a ticket left
`in-progress` with an open pull request and no worktree is picked up again by `next-ticket.mjs`, and
that session reads CI itself. Then `npm run agent:check -- --also <suite>` before pushing, naming
the suite that actually failed.
```

- [ ] **Step 6: Verify and commit**

```sh
npm run loop:test
npx tsc --noEmit
npx eslint tools/loop
git add -- tools/loop/next-ticket.mjs tools/loop/tests/nextTicket.test.ts .claude/commands/queue.md
git commit -m "Pick up a ticket whose supervisor died between CI rounds"
```

---

### Task 8: Independent shell calls travel together

**What this buys:** ~$4.70 a ticket. 160 tool calls on #1043 — 97 of them `Bash` — at the run's mean 141k context is about $0.07 each (spec §2), and many were single one-liners that had no reason to be separate turns.

This one cannot be a gate: nothing can tell "two commands that had to be sequential" from "two that did not" at the point of the call. So it is an instruction plus an instrument — the supervisor counts single-`Bash` turns and the ledger carries the number, which is what makes the next measurement able to say whether the instruction worked.

**Files:**
- Modify: `tools/loop/queue-loop.mjs:958-998, 1038-1056, 1108-1148, 1668-1721`
- Modify: `tools/loop/loop-logs.mjs:121-182`
- Modify: `CLAUDE.md` (a new bullet under Working agreement)
- Modify: `.claude/commands/queue.md` (phase C)
- Test: `tools/loop/tests/queueLoop.test.ts`

**Interfaces:**
- Produces: `watchCalls(state, fact): void` from `queue-loop.mjs`; `sessionRow` gains `solo_bash_turns`.
- Consumes: `fact.calls` from `readLine`, already parsed.

- [ ] **Step 1: Write the failing test**

Append to `tools/loop/tests/queueLoop.test.ts`:

```ts
test("a turn making one Bash call and nothing else is counted", () => {
  const state = { soloBash: 0, turns: 0 };
  watchCalls(state, { calls: [{ name: "Bash", command: "git status" }] });
  watchCalls(state, { calls: [{ name: "Bash", command: "ls" }, { name: "Bash", command: "pwd" }] });
  watchCalls(state, { calls: [{ name: "Read", command: "" }] });
  assert.equal(state.soloBash, 1);
  assert.equal(state.turns, 3);
});

test("a turn with no calls at all is not a turn that could have batched", () => {
  const state = { soloBash: 0, turns: 0 };
  watchCalls(state, { calls: [] });
  assert.equal(state.turns, 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```sh
node --test tools/loop/tests/queueLoop.test.ts
```

Expected: FAIL — `watchCalls is not defined`.

- [ ] **Step 3: Count them**

In `tools/loop/queue-loop.mjs`, beside `watchBuild`:

```js
/**
 * Turns that spent a full context read on one shell command.
 *
 * Not a warning and not a gate: nothing at the call site can tell a command that had to wait for the
 * last one from a command that did not. It is a number in the ledger, so "did the batching
 * instruction work" is a question the record can answer.
 *
 * @param {{soloBash: number, turns: number}} state
 * @param {{calls: {name: string}[]}} fact
 */
export function watchCalls(state, fact) {
  if (!fact.calls.length) return;
  state.turns += 1;
  if (fact.calls.length === 1 && fact.calls[0].name === "Bash") state.soloBash += 1;
}
```

Add `soloBash: 0, turns: 0` to `runTicket`'s `state`, call `watchCalls(state, fact)` beside `watchBuild`, and return `soloBash: state.soloBash, callTurns: state.turns` from the resolve object.

In `loop-logs.mjs`, add to `sessionRow`'s parameter and returned object:

```js
  /** Turns that spent a whole context read on one shell command. See queue-loop's `watchCalls`. */
  solo_bash_turns: soloBash ?? null,
```

with `soloBash = null` destructured and added to the JSDoc, and bump `SCHEMA` to `4`. Pass it through from `realIo.record`: `soloBash: run.soloBash ?? null`.

- [ ] **Step 4: Run it and watch it pass**

```sh
node --test tools/loop/tests/queueLoop.test.ts
```

Expected: PASS.

- [ ] **Step 5: State the instruction where both readers see it**

In `CLAUDE.md`, under **Working agreement**:

```markdown
- **Independent commands travel together.** A turn costs one read of the whole conversation — about
  seven cents at a working context — so four `git`/`grep`/`node` one-liners that do not depend on
  each other are one `Bash` call joined by `&&`, or four tool calls in one message, never four turns.
  Split only where a command needs the last one's output.
```

In `.claude/commands/queue.md`, phase C, after the commit-each-slice bullet:

```markdown
- **Batch what does not depend on the last answer.** A ticket's 97 `Bash` calls were mostly one
  one-liner each, and each paid a full context read. `.loop-logs` counts the turns that did that.
```

- [ ] **Step 6: Check the comment budget before committing**

This task writes more prose than most; check before the hook refuses a later edit:

```sh
npm run check:comments
```

Expected: `comment-budget: within budget`.

- [ ] **Step 7: Verify and commit**

```sh
npm run loop:test
npx tsc --noEmit
npx eslint tools/loop
git add -- tools/loop/queue-loop.mjs tools/loop/loop-logs.mjs tools/loop/tests/queueLoop.test.ts CLAUDE.md .claude/commands/queue.md
git commit -m "Count the turns that spent a context read on one shell command"
```

---

## Closing out

- [ ] **Run the whole harness**

```sh
npm run loop:test
npx tsc --noEmit
npx eslint tools/loop scripts
npm run check:comments
node --test tests/rulesAreSingleSourced.test.ts
```

`rulesAreSingleSourced` matters here: this plan edits `CLAUDE.md` and `queue.md` together, and that test is what refuses a rule stated in two places.

- [ ] **Open the pull request**

The body states, in this order: the before figures from the spec; which task attacks which; and the gate below. `Closes` nothing — this is loop machinery, filed against no ticket.

- [ ] **The gate this is measured against**

Merge, run five tickets with no further changes, then:

```sh
npm run loop:cost -- <first-new-ticket>+
```

Read the same window on both sides — a plain `npm run loop:cost` averages every ticket on disk, where five runs after a change are outvoted by the twenty before. Read it with no loop running.

| What the numbers say | Verdict |
|---|---|
| $/ticket ≤ $12 **and** phase D's share ≤ 60% | The context split worked. Keep going: split phase C the same way. |
| $/ticket fell, D's share did not | The saving came from the claim and the batching, not the split. Keep all three; do not split further. |
| $/ticket ≤ $12 but red pull requests continue | The money was the wrong target. Stop optimising cost and take the review's precision instead. |
| Nothing moved | Context re-reading was not the mechanism. **Stop.** Re-measure before building anything else. |

Post the answer as a comment on the pull request, the way #1049's gate did.

---

## Self-Review

**Spec coverage.** §1 (context re-read) → Task 1. §2 (per-call cost) → Tasks 3 and 8. §3 (phase D's share) → Task 1. §4 (rounds are not the waste) → a Global Constraint, and Task 4 makes the rounds visible rather than fewer. §5 (fleet economics) → Task 2's ceilings are set from it. §6 (dishonest `agent:check`, stranded fix round) → Tasks 6 and 7. §7 (scope growth) → **no task of its own, deliberately:** the Spec reviewer's brief already covers "behaviour in the diff that wasn't asked for", and the measured failure was that its report never reached the issue. Task 5 is what fixes that; a second mechanism counting files would be a third reading of the same rule. §8 (ranked levers) → the task order.

**Owner's two later asks.** "Which round of review, on the board" → Task 4. "Claiming is 1.5 minutes for setting a label" → Task 3.

**Placeholders.** None: every step carries the code or the exact command. Two steps are deliberately measured rather than stated — Task 4 step 6 reads `PHASE_MINUTES.D` off `loop:cost` instead of guessing a number, and Task 3 step 5's error path is described rather than written, because it depends on the shape of `realIo`'s existing `sh` catch. Both say so.

**Type consistency.** `handoff` is a phase letter everywhere (`loop-stream.mjs` parses, `handoffOf` returns, `runOnce` returns as `phase`, `nextRoute` takes as `at`). `round` is `{n, of}` in both `phaseRow` and `progress`. `stranded` takes `{openPr, liveWorktree}` in both its definition and both call sites. `pushVerdict` returns `{ok, why?, lines?}` and `roundVerdict` keeps its existing `{ok, why}` — different shapes, different names, no collision.

**One risk named.** Task 1 changes how many processes a ticket costs, and Task 4 step 6 re-paces the progress bar for it. If the loop is running when this lands, the first ticket after the merge sees a `queue.md` that asks for a handoff from a supervisor that already has the code for it — both halves are in the same commit, so there is no window where one is live without the other.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-14-loop-efficiency-reliability.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.

**2. Inline Execution** — tasks executed in this session, batched with checkpoints for review.

**Which approach?**
