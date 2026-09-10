# queue-loop Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `scripts/queue-loop.mjs` from a spawn-and-inherit wrapper into a supervisor that renders a readable per-ticket board, parks a stalled or failed ticket instead of halting the night, owns everything after the push, and records what each ticket cost.

**Architecture:** The child is spawned with `--output-format stream-json --verbose`, so its stdout is JSONL the supervisor parses. Two new pure modules do all the thinking that can be tested without spawning anything — `scripts/loop-stream.mjs` (one line → one fact) and `scripts/loop-render.mjs` (state → strings). `scripts/queue-loop.mjs` keeps only orchestration: spawn, watchdog, park, merge queue. Phase is derived — `scripts/loop-derive.mjs` stays the authority for C and D, and a marker table pinned against `.claude/commands/queue.md` covers A, B, E and F.

**Tech Stack:** Plain Node ESM (`.mjs`, no build step), `node:test` + `node:assert/strict` for tests written in TypeScript under `tests/`, `gh` CLI, `git`. Node 24 locally, Node 22 in production (irrelevant here — these scripts never ship to Replit).

**Spec:**
- `docs/superpowers/specs/2026-09-10-queue-loop-observability-design.md`
- `docs/superpowers/specs/2026-09-10-queue-loop-cost-and-speed-design.md`

## Global Constraints

- **No bare `git add -A` or `git add .` in the shared checkout.** Stage by pathspec (`docs/agents/RULES.md` rule 11). The one exception is inside a ticket's own worktree during the park path, which has its own index and no peer in it (rule 40) — that call is `git -C <worktree> add -A -- .` and carries a comment saying why.
- **Never `git worktree remove`, `rm -rf`, or `Remove-Item` on a worktree.** Always `npm run worktrees:remove -- <path>` (rule 39) — a recursive delete follows the `node_modules` junction and empties the shared install.
- **Every multi-line `gh` body goes through `--body-file`**, written UTF-8 without BOM. Never an inline `--body`.
- **Comments: default is none.** Only an invisible constraint, a *why* where the obvious approach is wrong, a contract the types cannot carry, or a pointer to the authority. Never a changelog, never an explanation of the defect being fixed (`CLAUDE.md`, rule 20).
- **A new test must fail before the code exists, and fail for the reason claimed** (rule 6). Every task below has an explicit "run it and watch it fail" step; do not skip it.
- **Run one test file at a time while iterating:** `node --test tests/<file>.test.ts`. Never a whole suite by hand (rule 2).
- **Local checks before the push are `npm run typecheck`, `npm run typecheck:strict`, `npm run lint`** via `npm run agent:check`. Jest and Playwright are CI's.
- `.loop-logs/` is gitignored and never committed.

---

## File Structure

| file | responsibility |
|---|---|
| `scripts/loop-stream.mjs` | **new.** One JSONL line → one loop-level fact. The phase-marker table and its `<placeholder>` → regex derivation. No IO. |
| `scripts/loop-render.mjs` | **new.** State → strings: header, phase line, closing line, morning-report row, run total. No IO. |
| `scripts/loop-record.mjs` | **new.** A finished run's facts → the `tickets.jsonl` row. No IO. |
| `scripts/loop-tools.mjs` | **new.** Reads `queue.md`'s `allowed-tools` frontmatter into the `--tools` list. |
| `scripts/queue-pre.mjs` | **new.** prune + preflight + reap, one command, for the supervisor and for a by-hand `/queue`. |
| `scripts/queue-loop.mjs` | **modified.** Spawn, stream, watchdog, park, no-progress guard, circuit breaker, `.loop-stop`, merge queue. |
| `.claude/commands/queue.md` | **modified.** Phase A starts at the picker; phase E ends at the push; phase F loses teardown. |
| `.gitignore`, `package.json` | **modified.** `.loop-logs/`, `queue:pre`. |
| `tests/loopStream.test.ts`, `tests/loopRender.test.ts`, `tests/loopRecord.test.ts` | **new.** |
| `tests/queueLoop.test.ts`, `tests/loopDocsAreExecutable.test.ts` | **modified.** |

---

## Task 1: `loop-stream.mjs` — one line, one fact

**Files:**
- Create: `scripts/loop-stream.mjs`
- Test: `tests/loopStream.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PHASE_MARKERS: {phase: string, tool: string, doc?: string}[]`
  - `toPattern(doc: string): RegExp`
  - `readLine(line: string): Fact | null` where `Fact` is one of
    `{kind:"init", sessionId, version}` ·
    `{kind:"tool", calls: {name, command, parent}[]}` ·
    `{kind:"rate_limit", resetsAt}` ·
    `{kind:"result", isError, subtype, terminalReason, cost, turns, durationMs, models, subagents, cache:{created,read}}`
  - `phaseOf(call: {name, command}): string | null`
  - `REDERIVE: RegExp` — a Bash command matching this may have moved the derived phase.

- [ ] **Step 1: Write the failing test**

Create `tests/loopStream.test.ts`:

```ts
// tests/loopStream.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readLine, phaseOf, toPattern, PHASE_MARKERS, REDERIVE } from "../scripts/loop-stream.mjs";

describe("readLine", () => {
  test("returns null for a line that is not JSON, rather than throwing", () => {
    assert.equal(readLine("not json at all"), null);
    assert.equal(readLine(""), null);
  });

  test("reads the session id and version off system/init", () => {
    const line = JSON.stringify({
      type: "system", subtype: "init", session_id: "abc-123", claude_code_version: "2.1.251",
    });
    assert.deepEqual(readLine(line), { kind: "init", sessionId: "abc-123", version: "2.1.251" });
  });

  test("reads a rate limit event and its reset time", () => {
    const line = JSON.stringify({
      type: "rate_limit_event", rate_limit_info: { status: "throttled", resetsAt: "2026-09-11T04:10:00Z" },
    });
    assert.deepEqual(readLine(line), { kind: "rate_limit", resetsAt: "2026-09-11T04:10:00Z" });
  });

  test("reads every tool_use block out of one assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "thinking", thinking: "..." },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "git commit -m x" } },
          { type: "tool_use", id: "t2", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    });
    assert.deepEqual(readLine(line), {
      kind: "tool",
      calls: [
        { name: "Bash", command: "git commit -m x", parent: null },
        { name: "Read", command: "", parent: null },
      ],
    });
  });

  test("carries parent_tool_use_id, which is how subagent work is told from the session's own", () => {
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "toolu_parent",
      message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
    });
    assert.equal(readLine(line).calls[0].parent, "toolu_parent");
  });

  test("an assistant message with no tool_use is not a fact", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
    assert.equal(readLine(line), null);
  });

  test("reads the whole final result event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 1.82,
      num_turns: 41,
      duration_ms: 1_420_000,
      terminal_reason: null,
      modelUsage: { "claude-opus-5": { costUSD: 1.6 }, "claude-sonnet-5": { costUSD: 0.22 } },
      subagent_stats: { spawned: 3, failed: 0 },
      usage: { cache_creation_input_tokens: 26069, cache_read_input_tokens: 15320 },
    });
    assert.deepEqual(readLine(line), {
      kind: "result",
      isError: false,
      subtype: "success",
      terminalReason: null,
      cost: 1.82,
      turns: 41,
      durationMs: 1_420_000,
      models: { "claude-opus-5": { costUSD: 1.6 }, "claude-sonnet-5": { costUSD: 0.22 } },
      subagents: { spawned: 3, failed: 0 },
      cache: { created: 26069, read: 15320 },
    });
  });

  test("a result missing usage and cost reads as zeroes, not as undefined", () => {
    const fact = readLine(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }));
    assert.equal(fact.cost, 0);
    assert.equal(fact.turns, 0);
    assert.deepEqual(fact.cache, { created: 0, read: 0 });
    assert.equal(fact.isError, true);
  });
});

describe("toPattern", () => {
  test("turns a queue.md placeholder into a wildcard and escapes the rest", () => {
    const re = toPattern("gh issue edit <n> --add-label in-progress");
    assert.ok(re.test("gh issue edit 953 --add-label in-progress"));
    assert.ok(!re.test("gh issue edit 953 --add-label ready-for-human"));
  });

  test("a regex metacharacter in the doc string is matched literally", () => {
    const re = toPattern("npm run worktrees:remove -- .worktrees/agent-<n>");
    assert.ok(re.test("npm run worktrees:remove -- .worktrees/agent-953"));
    assert.ok(!re.test("npm run worktreesXremove -- Yworktrees/agent-953"));
  });
});

describe("phaseOf", () => {
  test("the claim write marks phase A", () => {
    assert.equal(phaseOf({ name: "Bash", command: "gh issue edit 953 --add-label in-progress" }), "A");
  });

  test("a Task dispatch marks phase B whatever it says", () => {
    assert.equal(phaseOf({ name: "Task", command: "" }), "B");
  });

  test("the push marks phase E", () => {
    assert.equal(phaseOf({ name: "Bash", command: "git push -u origin agent/953-rate-limiter" }), "E");
  });

  test("an unrelated command marks nothing", () => {
    assert.equal(phaseOf({ name: "Bash", command: "ls -la" }), null);
    assert.equal(phaseOf({ name: "Read", command: "" }), null);
  });

  test("every marker names a tool and every Bash marker carries a doc string", () => {
    for (const m of PHASE_MARKERS) {
      assert.ok(m.tool, `marker for phase ${m.phase} names no tool`);
      if (m.tool === "Bash") assert.ok(m.doc, `Bash marker for phase ${m.phase} has no doc string to pin`);
    }
  });
});

describe("REDERIVE", () => {
  test("a commit and a verdict comment are both worth re-deriving after", () => {
    assert.ok(REDERIVE.test("git commit -m 'feat: x'"));
    assert.ok(REDERIVE.test("gh issue comment 953 --body-file /tmp/v.md"));
  });

  test("reading a file is not", () => {
    assert.ok(!REDERIVE.test("cat package.json"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/loopStream.test.ts`
Expected: FAIL — `Cannot find module '../scripts/loop-stream.mjs'`.

- [ ] **Step 3: Write `scripts/loop-stream.mjs`**

```js
/**
 * One line of `claude -p --output-format stream-json` as a fact the loop can act on.
 *
 * Everything here is pure: a line in, a fact or null out. The supervisor does the IO.
 */

/**
 * Which command in `queue.md` marks a phase `loop-derive.mjs` cannot see. A, B, E and F leave no
 * trace in git or the tracker at the moment they start, so they are read from what the session
 * runs — and `tests/loopDocsAreExecutable.test.ts` is what keeps each `doc` string a command
 * queue.md actually names.
 *
 * Nothing the loop *does* depends on this table. A marker that stops matching costs a phase line,
 * never a decision.
 */
export const PHASE_MARKERS = [
  { phase: "A", tool: "Bash", doc: "gh issue edit <n> --add-label in-progress" },
  { phase: "B", tool: "Task" },
  { phase: "E", tool: "Bash", doc: "git push -u origin agent/<n>-<slug>" },
  { phase: "F", tool: "Bash", doc: "npm run worktrees:remove -- .worktrees/agent-<n>" },
];

/** A `<placeholder>` stands for one argument; everything else in the doc string is literal. */
export function toPattern(doc) {
  const escaped = doc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped.replace(/<[a-z-]+>/g, "\\S+"));
}

const COMPILED = PHASE_MARKERS.map((m) => ({ ...m, pattern: m.doc ? toPattern(m.doc) : null }));

/** A Bash command after which the derived phase may have moved. */
export const REDERIVE = /^(git commit|gh issue comment|node scripts\/loop-gate\.mjs)/;

export function phaseOf(call) {
  for (const m of COMPILED) {
    if (m.tool !== call.name) continue;
    if (!m.pattern) return m.phase;
    if (m.pattern.test(call.command)) return m.phase;
  }
  return null;
}

export function readLine(line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  if (e.type === "system" && e.subtype === "init") {
    return { kind: "init", sessionId: e.session_id ?? null, version: e.claude_code_version ?? null };
  }
  if (e.type === "rate_limit_event") {
    return { kind: "rate_limit", resetsAt: e.rate_limit_info?.resetsAt ?? null };
  }
  if (e.type === "assistant") {
    const calls = (e.message?.content ?? [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        name: b.name,
        command: String(b.input?.command ?? ""),
        parent: e.parent_tool_use_id ?? null,
      }));
    return calls.length ? { kind: "tool", calls } : null;
  }
  if (e.type === "result") {
    return {
      kind: "result",
      isError: Boolean(e.is_error),
      subtype: e.subtype ?? null,
      terminalReason: e.terminal_reason ?? null,
      cost: e.total_cost_usd ?? 0,
      turns: e.num_turns ?? 0,
      durationMs: e.duration_ms ?? 0,
      models: e.modelUsage ?? {},
      subagents: e.subagent_stats ?? null,
      cache: {
        created: e.usage?.cache_creation_input_tokens ?? 0,
        read: e.usage?.cache_read_input_tokens ?? 0,
      },
    };
  }
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test tests/loopStream.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add -- scripts/loop-stream.mjs tests/loopStream.test.ts
git commit -m "feat(loop): read one stream-json line as one loop-level fact"
```

---

## Task 2: `loop-render.mjs` — state to strings

**Files:**
- Create: `scripts/loop-render.mjs`
- Test: `tests/loopRender.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PHASES: [string, string][]` — `[["A","claim"],["B","scope"],["C","build"],["D","review"],["E","push"],["F","close"]]`
  - `elapsed(ms: number): string`
  - `header({number, title, size, url, queue}): string`
  - `phaseLine({letter, detail, ms}): string`
  - `closing({outcome, number, files, turns, ms, cost, log, why}): string`
  - `reportRow({number, title, outcome, pr, ms, cost, why}): string`
  - `runTotal({tickets, landed, parked, ms, cost}): string`

- [ ] **Step 1: Write the failing test**

Create `tests/loopRender.test.ts`:

```ts
// tests/loopRender.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { elapsed, header, phaseLine, closing, reportRow, runTotal, PHASES } from "../scripts/loop-render.mjs";

describe("elapsed", () => {
  test("m:ss under an hour, zero-padded seconds", () => {
    assert.equal(elapsed(12_000), "0:12");
    assert.equal(elapsed(104_000), "1:44");
    assert.equal(elapsed(0), "0:00");
  });

  test("h:mm:ss over an hour", () => {
    assert.equal(elapsed(3_723_000), "1:02:03");
  });
});

describe("header", () => {
  const h = header({
    number: 953,
    title: "Rate limiter factory",
    size: "size:S",
    url: "https://github.com/metasito/murlan/issues/953",
    queue: { implement: 7, triage: 2, wayfinder: 1 },
  });

  test("names the ticket, its size and its link", () => {
    assert.match(h, /#953/);
    assert.match(h, /Rate limiter factory/);
    assert.match(h, /size:S/);
    assert.match(h, /github\.com\/metasito\/murlan\/issues\/953/);
  });

  test("shows how much work is behind this one", () => {
    assert.match(h, /queue: 7 · 2 · 1/);
  });

  test("a ticket with no size label still renders", () => {
    const none = header({ number: 1, title: "x", size: null, url: "u", queue: { implement: 0, triage: 0, wayfinder: 0 } });
    assert.match(none, /#1/);
    assert.ok(!none.includes("null"));
  });

  test("a long title does not push the size label off the line", () => {
    const long = header({
      number: 953,
      title: "A ticket title that is considerably longer than the eighty column budget allows for",
      size: "size:XL",
      url: "u",
      queue: { implement: 1, triage: 0, wayfinder: 0 },
    });
    for (const line of long.split("\n")) assert.ok(line.length <= 78, `line over budget: ${line}`);
    assert.match(long, /size:XL/);
  });
});

describe("phaseLine", () => {
  test("numbers the phase out of six and keeps queue.md's letter", () => {
    const line = phaseLine({ letter: "C", detail: "3 commits · 4 files", ms: 511_000 });
    assert.match(line, /\[3\/6\]/);
    assert.match(line, /\bC\b/);
    assert.match(line, /build/);
    assert.match(line, /3 commits · 4 files/);
    assert.match(line, /8:31/);
  });

  test("every phase in PHASES renders and they are the six queue.md defines", () => {
    assert.deepEqual(PHASES.map(([l]) => l), ["A", "B", "C", "D", "E", "F"]);
    for (const [letter] of PHASES) {
      assert.match(phaseLine({ letter, detail: "", ms: 0 }), new RegExp(`\\b${letter}\\b`));
    }
  });
});

describe("closing", () => {
  test("a landed ticket leads with the tick and carries the figures", () => {
    const c = closing({
      outcome: "landed", number: 953, files: 4, turns: 41, ms: 1_420_000, cost: 1.82,
      log: ".loop-logs/953.jsonl",
    });
    assert.match(c, /✅/);
    assert.match(c, /#953/);
    assert.match(c, /4 files/);
    assert.match(c, /41 turns/);
    assert.match(c, /\$1\.82/);
  });

  test("a parked ticket says why, and says where the log is", () => {
    const c = closing({
      outcome: "parked", number: 953, why: "no output for 30m in phase C",
      ms: 1_800_000, cost: 0.9, log: ".loop-logs/953.jsonl",
    });
    assert.match(c, /⚠️/);
    assert.match(c, /no output for 30m in phase C/);
    assert.match(c, /\.loop-logs\/953\.jsonl/);
  });

  test("a rate limit says when it resets and is not an outcome", () => {
    const c = closing({ outcome: "rate_limited", number: 953, why: "resets 04:10", ms: 0, cost: 0 });
    assert.match(c, /⏸/);
    assert.match(c, /04:10/);
  });
});

describe("reportRow", () => {
  test("one fixed-width line per ticket, for the morning file", () => {
    const row = reportRow({
      number: 953, title: "Rate limiter factory", outcome: "landed", pr: 1204,
      ms: 1_420_000, cost: 1.82,
    });
    assert.match(row, /#953/);
    assert.match(row, /landed/);
    assert.match(row, /1204/);
    assert.ok(!row.includes("\n"), "a report row is one line");
  });

  test("a parked row carries the reason instead of a PR", () => {
    const row = reportRow({
      number: 970, title: "Reconnect backoff", outcome: "parked", pr: null,
      ms: 900_000, cost: 1.48, why: "no review after 4 rounds",
    });
    assert.match(row, /parked/);
    assert.match(row, /no review after 4 rounds/);
    assert.ok(!row.includes("null"));
  });
});

describe("runTotal", () => {
  test("counts the night", () => {
    const t = runTotal({ tickets: 3, landed: 2, parked: 1, ms: 11_520_000, cost: 6.4 });
    assert.match(t, /3 tickets/);
    assert.match(t, /2 landed/);
    assert.match(t, /1 parked/);
    assert.match(t, /\$6\.40/);
    assert.match(t, /3:12:00/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/loopRender.test.ts`
Expected: FAIL — `Cannot find module '../scripts/loop-render.mjs'`.

- [ ] **Step 3: Write `scripts/loop-render.mjs`**

```js
/**
 * What the loop prints. Pure: state in, strings out, so every line is a unit test and none of it
 * needs a terminal.
 *
 * Append-only by design — one line as each phase closes, never a redraw. The same output has to be
 * right in a terminal, in a pipe, and in a file, and cursor control is right in exactly one of
 * those.
 */
const WIDTH = 78;

export const PHASES = [
  ["A", "claim"],
  ["B", "scope"],
  ["C", "build"],
  ["D", "review"],
  ["E", "push"],
  ["F", "close"],
];

export function elapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const rule = "━".repeat(WIDTH);

function fit(left, right) {
  const gap = WIDTH - left.length - right.length;
  if (gap >= 1) return left + " ".repeat(gap) + right;
  return left.slice(0, Math.max(0, WIDTH - right.length - 2)) + "… " + right;
}

export function header({ number, title, size, url, queue }) {
  const depths = `queue: ${queue.implement} · ${queue.triage} · ${queue.wayfinder}`;
  return [
    "",
    rule,
    fit(` ⚙️  #${number} · ${title}`, size ? `${size} ` : ""),
    fit(`    ${url}`, `${depths} `),
    rule,
  ].join("\n");
}

export function phaseLine({ letter, detail, ms }) {
  const i = PHASES.findIndex(([l]) => l === letter);
  const name = PHASES[i]?.[1] ?? "";
  const left = `  ✓ [${i + 1}/6] ${letter}  ${name.padEnd(9)}${detail}`;
  return fit(left, `${elapsed(ms)} `);
}

const MARK = { landed: "✅", merged: "✅", parked: "⚠️", failed: "❌", rate_limited: "⏸" };

export function closing({ outcome, number, files, turns, ms, cost, log, why }) {
  const mark = MARK[outcome] ?? "•";
  const head =
    outcome === "landed" || outcome === "merged"
      ? `  ${mark} #${number} ${outcome} · ${files} files · ${turns} turns · ${elapsed(ms)} · ${money(cost)}`
      : `  ${mark} #${number} ${outcome.replace("_", " ")} — ${why}`;
  return log ? `${head}\n     log ${log}` : head;
}

export function reportRow({ number, title, outcome, pr, ms, cost, why }) {
  const tail = pr ? `PR #${pr}` : (why ?? "");
  return fit(
    `${MARK[outcome] ?? "•"} #${number} ${title}`.slice(0, 46).padEnd(46) + `${outcome.padEnd(8)}${tail}`,
    `${elapsed(ms)}  ${money(cost)}`
  );
}

export function runTotal({ tickets, landed, parked, ms, cost }) {
  return `${tickets} tickets · ${landed} landed · ${parked} parked · ${elapsed(ms)} · ${money(cost)}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test tests/loopRender.test.ts`
Expected: PASS. If the long-title test fails on width, fix `fit()` — not the test; the 78-column budget is the requirement.

- [ ] **Step 5: Commit**

```bash
git add -- scripts/loop-render.mjs tests/loopRender.test.ts
git commit -m "feat(loop): render the per-ticket board as pure strings"
```

---

## Task 3: Spawn the child as a stream and print the board

**Files:**
- Modify: `scripts/queue-loop.mjs`
- Modify: `tests/queueLoop.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `readLine`, `phaseOf`, `REDERIVE` (Task 1); `header`, `phaseLine`, `closing` (Task 2); `derive` (`scripts/loop-derive.mjs`, existing).
- Produces:
  - `queueLoopArgs(): string[]` — extended, still exported, still unit-tested.
  - `advance(current: string|null, next: string|null): string|null` — phase only ever moves forward.
  - `runTicket(spawnFn, opts): Promise<{status, result, phases}>`

- [ ] **Step 1: Write the failing test**

Add to `tests/queueLoop.test.ts` (keep every existing test in the file):

```ts
import { advance, queueLoopArgs } from "../scripts/queue-loop.mjs";

describe("queueLoopArgs", () => {
  test("streams JSON, which needs --verbose, and stays unattended", () => {
    const args = queueLoopArgs();
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("/queue"));
    assert.ok(args.includes("--output-format"));
    assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
    assert.ok(args.includes("--verbose"), "stream-json in print mode is refused without --verbose");
    assert.ok(args.includes("--permission-mode"));
    assert.ok(args.includes("--strict-mcp-config"));
  });
});

describe("advance", () => {
  test("moves the phase forward", () => {
    assert.equal(advance("A", "C"), "C");
    assert.equal(advance(null, "A"), "A");
  });

  test("never moves it back — a late marker for an earlier phase is ignored", () => {
    assert.equal(advance("D", "B"), "D");
    assert.equal(advance("C", null), "C");
  });

  test("an unknown letter does not move it at all", () => {
    assert.equal(advance("C", "Z"), "C");
  });
});
```

Note: the existing `queueLoopArgs` test in the file asserts an exact array. **Replace that test with the one above** — the exact-array form pins nothing useful once flags are added, and it will fail on the first new flag.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/queueLoop.test.ts`
Expected: FAIL — `advance` is not exported, and `--output-format` is absent.

- [ ] **Step 3: Implement in `scripts/queue-loop.mjs`**

Replace `queueLoopArgs` and `runOneTicket`. Key points:

```js
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { readLine, phaseOf, REDERIVE } from "./loop-stream.mjs";
import { header, phaseLine, closing, PHASES } from "./loop-render.mjs";

export function queueLoopArgs() {
  return [
    "-p", "/queue",
    "--permission-mode", "auto",
    "--strict-mcp-config",
    "--output-format", "stream-json",
    // stream-json in print mode is refused without it: "Error: When using --print,
    // --output-format=stream-json requires --verbose".
    "--verbose",
  ];
}

const ORDER = PHASES.map(([l]) => l);
export function advance(current, next) {
  const a = ORDER.indexOf(current);
  const b = ORDER.indexOf(next);
  return b > a ? ORDER[b] : current;
}
```

`runTicket(spawnFn, { logPath, onFact })`:
- `mkdirSync(".loop-logs", { recursive: true })`, open an append stream on `logPath`.
- `spawnFn("claude", queueLoopArgs(), { stdio: ["ignore", "pipe", "inherit"] })` — stderr stays inherited so a crash prints itself.
- `createInterface({ input: child.stdout })`, and for each line: write it plus `"\n"` to the log stream, then `const fact = readLine(line)`; if non-null call `onFact(fact)`.
- Resolve on the child's `close` event with `{ status, result }` where `result` is the last `{kind:"result"}` fact seen.
- `spawnFn` is a parameter so the tests can drive it with a fake that emits fixture lines; production passes `spawn`.

Board state lives in the supervisor's loop, not in `runTicket`: on each `{kind:"tool"}` fact, for each call, `phaseOf(call)` → `advance`; if the phase changed, print `phaseLine`. If any call's command matches `REDERIVE`, call `derive()` and `advance` to `derive().phase` as well. Print the header the first time the phase reaches `A` and `derive()` reports a ticket, fetching title/labels/url with one `gh issue view <n> --json title,labels,url`.

Heartbeat: only when `process.stdout.isTTY`, a `setInterval` every 20s writing `\r  ◐ [n/6] <letter>  <name>  <elapsed>` with no newline; cleared and overwritten when the real phase line prints, and `clearInterval` on close.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `.loop-logs/` to `.gitignore`**

Append next to the existing `.worktrees/` entry:

```
# Per-ticket stream logs and the run's own report. Large, local, and never reviewed.
.loop-logs/
```

- [ ] **Step 6: Commit**

```bash
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts .gitignore
git commit -m "feat(loop): parse the session's stream and print a phase board"
```

---

## Task 4: The stall watchdog and the park path

**Files:**
- Modify: `scripts/queue-loop.mjs`
- Modify: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `runTicket` (Task 3), `derive`.
- Produces:
  - `STALL_MS: number`
  - `stalled(lastFactAt: number, now: number): boolean`
  - `park(ticket, {phase, why, log, run}): Promise<void>` where `run(file, args, opts)` is injected so tests never shell out.

- [ ] **Step 1: Write the failing test**

Add to `tests/queueLoop.test.ts`:

```ts
import { stalled, STALL_MS, park } from "../scripts/queue-loop.mjs";

describe("stalled", () => {
  test("silence past the ceiling is a stall", () => {
    assert.equal(stalled(0, STALL_MS + 1), true);
  });

  test("silence inside it is not — a CI wait is legitimately quiet for twenty minutes", () => {
    assert.equal(stalled(0, 20 * 60_000), false);
    assert.equal(STALL_MS > 20 * 60_000, true, "the ceiling must clear a real ciVerdict wait");
  });
});

describe("park", () => {
  const recorder = () => {
    const calls: { file: string; args: string[] }[] = [];
    return { calls, run: (file: string, args: string[]) => { calls.push({ file, args }); return ""; } };
  };
  const ran = (calls: { file: string; args: string[] }[], needle: string) =>
    calls.some((c) => [c.file, ...c.args].join(" ").includes(needle));

  test("commits the worktree's own dirty tree before removing it, so nothing is lost", async () => {
    const { calls, run } = recorder();
    await park(953, { phase: "C", why: "stalled", log: "x.jsonl", cwd: ".worktrees/agent-953", dirty: true, run });
    const commitAt = calls.findIndex((c) => c.args.includes("commit"));
    const removeAt = calls.findIndex((c) => c.args.join(" ").includes("worktrees:remove"));
    assert.ok(commitAt !== -1, "a dirty worktree must be committed");
    assert.ok(removeAt > commitAt, "the worktree is removed only after its work is committed");
  });

  test("releases the claim and hands the ticket to the owner", async () => {
    const { calls, run } = recorder();
    await park(953, { phase: "C", why: "stalled", log: "x.jsonl", cwd: ".worktrees/agent-953", dirty: false, run });
    assert.ok(ran(calls, "--remove-label in-progress"));
    assert.ok(ran(calls, "--add-label ready-for-human"));
  });

  test("the reason goes on the issue through a file, never an inline body", async () => {
    const { calls, run } = recorder();
    await park(953, { phase: "C", why: "stalled", log: "x.jsonl", cwd: ".worktrees/agent-953", dirty: false, run });
    const comment = calls.find((c) => c.args.includes("comment"));
    assert.ok(comment, "park must comment on the issue");
    assert.ok(comment.args.includes("--body-file"), "an inline --body is word-split and mojibaked");
  });

  test("removes the worktree only through the named script, never git worktree remove", async () => {
    const { calls, run } = recorder();
    await park(953, { phase: "C", why: "stalled", log: "x.jsonl", cwd: ".worktrees/agent-953", dirty: false, run });
    assert.ok(ran(calls, "worktrees:remove"));
    assert.ok(!ran(calls, "worktree remove"), "a recursive delete follows the node_modules junction");
  });

  test("a clean worktree is not given an empty commit", async () => {
    const { calls, run } = recorder();
    await park(953, { phase: "C", why: "stalled", log: "x.jsonl", cwd: ".worktrees/agent-953", dirty: false, run });
    assert.ok(!calls.some((c) => c.args.includes("commit")));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/queueLoop.test.ts`
Expected: FAIL — `stalled`, `STALL_MS` and `park` are not exported.

- [ ] **Step 3: Implement**

```js
/**
 * `lib/loop/ciVerdict.ts` blocks in phase E waiting for a CI run, which regularly takes twenty
 * minutes and emits nothing while it does. Anything at or under that reads a working run as a
 * stalled one.
 */
export const STALL_MS = 30 * 60_000;

export const stalled = (lastFactAt, now) => now - lastFactAt > STALL_MS;
```

`park(number, { phase, why, log, cwd, dirty, run })`, in order:

1. If `dirty`: `run("git", ["-C", cwd, "add", "-A", "--", "."])` then
   `run("git", ["-C", cwd, "commit", "-m", \`wip(#${number}): parked in phase ${phase}\`])`.
   The comment above that call says why `-A` is right here and nowhere else: a ticket worktree has
   its own index and rule 40 keeps every peer out of it.
2. `run("gh", ["issue", "edit", String(number), "--remove-label", "in-progress", "--add-label", "ready-for-human"])`.
3. Write the body with `fs.writeFileSync(file, text, "utf8")` — never `Set-Content` — then
   `run("gh", ["issue", "comment", String(number), "--body-file", file])`. The body names the phase
   reached, what is committed and on which branch, the reason, and the log path.
4. `run("npm", ["run", "worktrees:remove", "--", cwd])`.

Any throw propagates: the caller halts rather than looping with a ticket in an unknown state.

Wire the watchdog into `runTicket`: record `lastFactAt = Date.now()` on every parsed line; a
`setInterval` every 30s checks `stalled(lastFactAt, Date.now())` and on true sends `SIGTERM`, then
`SIGKILL` after 10s, and resolves with `{ status: "stalled" }`.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts
git commit -m "feat(loop): kill a stalled session and park its ticket"
```

---

## Task 5: No-progress guard, circuit breaker, `.loop-stop`

**Files:**
- Modify: `scripts/queue-loop.mjs`
- Modify: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `park` (Task 4), `derive`.
- Produces:
  - `madeProgress(prev, now): boolean` — `prev`/`now` are `{ticket, head, commits}` or `null`.
  - `shouldHalt(consecutiveFailures: number): boolean`
  - `BREAKER: number` (3)
  - `takeStopFile(fs, path): boolean` — true if it existed; deletes it.

- [ ] **Step 1: Write the failing test**

```ts
import { madeProgress, shouldHalt, BREAKER, takeStopFile } from "../scripts/queue-loop.mjs";

describe("madeProgress", () => {
  test("a first sighting of a ticket is progress", () => {
    assert.equal(madeProgress(null, { ticket: 953, head: "aaa", commits: 0 }), true);
  });

  test("a different ticket is progress", () => {
    assert.equal(madeProgress({ ticket: 953, head: "aaa", commits: 2 }, { ticket: 961, head: "aaa", commits: 2 }), true);
  });

  test("the same ticket with a new head is progress", () => {
    assert.equal(madeProgress({ ticket: 953, head: "aaa", commits: 2 }, { ticket: 953, head: "bbb", commits: 3 }), true);
  });

  test("the same ticket, same head, same commits is not — this is the loop resuming forever", () => {
    assert.equal(madeProgress({ ticket: 953, head: "aaa", commits: 2 }, { ticket: 953, head: "aaa", commits: 2 }), false);
  });
});

describe("shouldHalt", () => {
  test("one bad ticket is a ticket; three in a row is the loop or the machine", () => {
    assert.equal(shouldHalt(1), false);
    assert.equal(shouldHalt(BREAKER - 1), false);
    assert.equal(shouldHalt(BREAKER), true);
  });
});

describe("takeStopFile", () => {
  test("absent means carry on, and nothing is deleted", () => {
    const calls: string[] = [];
    const fs = { existsSync: () => false, rmSync: (p: string) => calls.push(p) };
    assert.equal(takeStopFile(fs, ".loop-stop"), false);
    assert.deepEqual(calls, []);
  });

  test("present means drain, and reading it removes it so it cannot go stale", () => {
    const calls: string[] = [];
    const fs = { existsSync: () => true, rmSync: (p: string) => calls.push(p) };
    assert.equal(takeStopFile(fs, ".loop-stop"), true);
    assert.deepEqual(calls, [".loop-stop"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `node --test tests/queueLoop.test.ts`, four undefined exports.

- [ ] **Step 3: Implement**

```js
export const BREAKER = 3;
export const shouldHalt = (consecutiveFailures) => consecutiveFailures >= BREAKER;

export function madeProgress(prev, now) {
  if (!prev || prev.ticket !== now.ticket) return true;
  return prev.head !== now.head || prev.commits !== now.commits;
}

export function takeStopFile(fs, path) {
  if (!fs.existsSync(path)) return false;
  fs.rmSync(path);
  return true;
}
```

In `main()`: hold `prev` across iterations (a live process, not a file — nothing is stored). After
each ticket, `const now = { ticket, head, commits }` from `derive()`; if `!madeProgress(prev, now)`
park it with `why: "resumed with nothing committed since the last run"`. Count consecutive
non-landing outcomes and `shouldHalt` on the count. Check `takeStopFile(fs, ".loop-stop")` at the
top of each iteration and exit 0 cleanly if true.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Commit**

```bash
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts
git commit -m "feat(loop): stop resuming a ticket that is not moving, and add a drain file"
```

---

## Task 6: The morning report and `loop-record.mjs`

**Files:**
- Create: `scripts/loop-record.mjs`
- Create: `tests/loopRecord.test.ts`
- Modify: `scripts/queue-loop.mjs`

**Interfaces:**
- Consumes: the `{kind:"result"}` fact (Task 1), `reportRow`/`runTotal` (Task 2).
- Produces: `row({number, size, outcome, pr, phases, result, ci, reviewRounds, startedAt}): object`

- [ ] **Step 1: Write the failing test**

```ts
// tests/loopRecord.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { row } from "../scripts/loop-record.mjs";

const RESULT = {
  kind: "result", isError: false, subtype: "success", terminalReason: null,
  cost: 1.82, turns: 41, durationMs: 1_420_000,
  models: { "claude-opus-5": { costUSD: 1.6 }, "claude-sonnet-5": { costUSD: 0.22 } },
  subagents: { spawned: 3, failed: 0 },
  cache: { created: 26069, read: 15320 },
};

describe("row", () => {
  const r = row({
    number: 953, size: "size:S", outcome: "landed", pr: 1204,
    phases: { A: 12, B: 92, C: 407, D: 212, E: 1375, F: 45 },
    result: RESULT, ci: { runs: 1, red: 0 }, reviewRounds: 2,
    startedAt: "2026-09-10T22:14:03Z", version: "2.1.251",
  });

  test("carries the ticket, its size and its outcome", () => {
    assert.equal(r.n, 953);
    assert.equal(r.size, "size:S");
    assert.equal(r.outcome, "landed");
    assert.equal(r.pr, 1204);
  });

  test("keeps phase durations in seconds, so a night is comparable", () => {
    assert.deepEqual(r.phases, { A: 12, B: 92, C: 407, D: 212, E: 1375, F: 45 });
  });

  test("collapses modelUsage to cost per model", () => {
    assert.deepEqual(r.models, { "claude-opus-5": 1.6, "claude-sonnet-5": 0.22 });
  });

  test("records the cache, because whether a prefix was reused is the whole question", () => {
    assert.deepEqual(r.cache, { created: 26069, read: 15320 });
  });

  test("a result with no modelUsage still produces a row", () => {
    const bare = row({
      number: 1, size: null, outcome: "parked", pr: null, phases: { A: 5 },
      result: { ...RESULT, models: {}, subagents: null }, ci: null, reviewRounds: 0,
      startedAt: "2026-09-10T22:14:03Z", version: null,
    });
    assert.deepEqual(bare.models, {});
    assert.equal(bare.outcome, "parked");
    assert.equal(bare.pr, null);
  });

  test("the row is JSON-serialisable, since it is written one per line", () => {
    assert.doesNotThrow(() => JSON.stringify(r));
    assert.ok(!JSON.stringify(r).includes("\n"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Write `scripts/loop-record.mjs`**

```js
/**
 * A finished ticket as one line of `.loop-logs/tickets.jsonl`.
 *
 * Nothing reads this file back. It exists so the next question about the loop is answered with a
 * measurement rather than an estimate — which is how the decision to overlap the CI wait was made.
 */
export function row({ number, size, outcome, pr, phases, result, ci, reviewRounds, startedAt, version }) {
  const models = Object.fromEntries(
    Object.entries(result.models ?? {}).map(([name, u]) => [name, u.costUSD ?? 0])
  );
  return {
    n: number,
    size: size ?? null,
    outcome,
    pr: pr ?? null,
    phases,
    cost: result.cost,
    turns: result.turns,
    models,
    subagents: result.subagents ?? null,
    cache: result.cache,
    ci: ci ?? null,
    review_rounds: reviewRounds,
    claude_version: version ?? null,
    started: startedAt,
  };
}
```

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Wire it into `queue-loop.mjs`**

After each ticket, append `JSON.stringify(row({...})) + "\n"` to `.loop-logs/tickets.jsonl`, and
append `reportRow({...}) + "\n"` to `.loop-logs/run-<YYYY-MM-DD>.md` (creating it with a
`# queue-loop <date>` heading when absent). Both with `fs.appendFileSync(..., "utf8")` — per ticket
as it finishes, never batched at exit, so a crash keeps what was already done. On halt, append
`runTotal({...})`.

Prune at loop start: delete `.loop-logs/*.jsonl` older than 7 days, `tickets.jsonl` excepted.

- [ ] **Step 6: Commit**

```bash
git add -- scripts/loop-record.mjs tests/loopRecord.test.ts scripts/queue-loop.mjs
git commit -m "feat(loop): record what each ticket cost and write a morning report"
```

---

## Task 7: `queue-pre.mjs` and phase A's housekeeping

**Files:**
- Create: `scripts/queue-pre.mjs`
- Modify: `package.json`, `.claude/commands/queue.md`, `scripts/queue-loop.mjs`
- Modify: `tests/loopDocsAreExecutable.test.ts`

**Interfaces:**
- Produces: `npm run queue:pre`, exit 0 clean / exit 1 with the reason.

- [ ] **Step 1: Write the failing test**

Add to `tests/loopDocsAreExecutable.test.ts`:

```ts
test("phase A's housekeeping is the supervisor's, and queue.md names the one command a person runs", () => {
  const text = read(QUEUE);
  assert.match(text, /npm run queue:pre/, "a by-hand /queue still needs the pre-checks");
  for (const moved of ["node scripts/prune-worktrees.mjs", "node scripts/preflight.mjs"]) {
    assert.ok(!text.includes(moved), `${moved} moved to the supervisor; queue.md must not ask for it too`);
  }
});
```

- [ ] **Step 2: Run it and watch it fail** — `node --test tests/loopDocsAreExecutable.test.ts`.

- [ ] **Step 3: Write `scripts/queue-pre.mjs`**

Runs, in order, stopping at the first non-zero: `node scripts/prune-worktrees.mjs`,
`node scripts/preflight.mjs`, `node scripts/reap.mjs --stale`. Each via `spawnSync(process.execPath, [...], { stdio: "inherit" })`.
Exit with the first failing step's code, naming it.

`reap --stale` takes only what is orphaned *and* old, so it cannot touch a peer's live run — say
that in one comment, not three.

- [ ] **Step 4: Add the script and edit `queue.md`**

`package.json`: `"queue:pre": "node scripts/queue-pre.mjs"`.

`queue.md` phase A: drop the `prune-worktrees` and `preflight` lines, and replace them with one
sentence — the loop has already run `npm run queue:pre`; a by-hand `/queue` runs it first. Keep
`loop-status.mjs` exactly where it is: it is what tells a fresh session a run is live, and that
must not depend on how the session was started.

Call `queue-pre` from `queue-loop.mjs` before `nextRoute()`, and halt the loop on a non-zero exit.

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test tests/loopDocsAreExecutable.test.ts` — PASS.
Run: `npm run queue:pre` — it should report a clean checkout and exit 0.

- [ ] **Step 6: Commit**

```bash
git add -- scripts/queue-pre.mjs scripts/queue-loop.mjs package.json .claude/commands/queue.md tests/loopDocsAreExecutable.test.ts
git commit -m "feat(loop): run the loop's housekeeping in the supervisor, not in the ticket"
```

---

## Task 8: The supervisor owns everything after the push

**Files:**
- Modify: `scripts/queue-loop.mjs`, `.claude/commands/queue.md`
- Modify: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `lib/loop/ciVerdict.ts` and `lib/loop/land.ts` via `npx tsx`, exactly as `queue.md` calls them today.
- Produces: `afterPush(ticket, { verdict, landing }): {action: "merged"|"fix"|"park", why: string}`

- [ ] **Step 1: Write the failing test**

```ts
import { afterPush } from "../scripts/queue-loop.mjs";

describe("afterPush", () => {
  test("green and clean merges", () => {
    const r = afterPush(953, { verdict: { pass: true }, landing: { action: "merge", reason: "CLEAN" } });
    assert.equal(r.action, "merged");
  });

  test("green but behind updates the branch first, and does not merge on the old verdict", () => {
    const r = afterPush(953, { verdict: { pass: true }, landing: { action: "update-branch", reason: "BEHIND" } });
    assert.equal(r.action, "update-branch");
  });

  test("red hands the ticket back to a session rather than parking it", () => {
    const r = afterPush(953, { verdict: { pass: false, failedStep: "lint", output: "..." } });
    assert.equal(r.action, "fix");
    assert.match(r.why, /lint/);
  });

  test("a job that ran zero steps says nothing about the diff, so it is asked again, not fixed", () => {
    const r = afterPush(953, { verdict: { pass: false, infrastructure: true } });
    assert.equal(r.action, "retry-verdict");
  });

  test("a conflicting branch parks — a merge that needs forcing is a decision", () => {
    const r = afterPush(953, { verdict: { pass: true }, landing: { action: "stop", reason: "the branch conflicts with main" } });
    assert.equal(r.action, "park");
    assert.match(r.why, /conflicts/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement**

```js
/**
 * What to do with a ticket whose session has already exited. Pure, so the branch table is a test
 * rather than a thing to reason about at 3am; the caller does the shelling out.
 */
export function afterPush(ticket, { verdict, landing }) {
  if (verdict.infrastructure) return { action: "retry-verdict", why: "a job completed having run zero steps" };
  if (!verdict.pass) return { action: "fix", why: `CI failed at ${verdict.failedStep ?? "an unnamed step"}` };
  if (landing?.action === "merge") return { action: "merged", why: landing.reason };
  if (landing?.action === "update-branch") return { action: "update-branch", why: landing.reason };
  return { action: "park", why: landing?.reason ?? "the pull request is not mergeable" };
}
```

The caller runs `npx tsx lib/loop/ciVerdict.ts metasito/murlan <branch> <pr>` and
`npx tsx lib/loop/land.ts metasito/murlan <pr>`, parses their JSON, and acts. `update-branch` runs
`gh pr update-branch` then goes round from `ciVerdict` again. `fix` spawns a fresh
`claude -p "/queue"`, which finds the ticket through `derive()`. Three `fix` rounds on the same
`failedStep`, then `park`.

`queue.md` phase E: everything from `npx tsx lib/loop/ciVerdict.ts` onward is deleted, replaced by
one line — push, then stop; the loop takes it from there. Phase F keeps steps 1–3 (re-read the
issue, tick the Definition of done, the plain-language line) and loses step 4's teardown, which the
supervisor now does with the merge.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Commit**

```bash
git add -- scripts/queue-loop.mjs .claude/commands/queue.md tests/queueLoop.test.ts
git commit -m "feat(loop): the supervisor waits for CI and merges, not the model"
```

---

## Task 9: Overlap the CI wait

**Files:**
- Modify: `scripts/queue-loop.mjs`
- Modify: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `afterPush` (Task 8).
- Produces: `canStartNext({pending, changed}): {ok: boolean, why: string}`

- [ ] **Step 1: Write the failing test**

```ts
import { canStartNext } from "../scripts/queue-loop.mjs";

describe("canStartNext", () => {
  test("nothing pending, so start", () => {
    assert.equal(canStartNext({ pending: null }).ok, true);
  });

  test("a pending ticket awaiting its first verdict does not block the next one", () => {
    assert.equal(canStartNext({ pending: { ticket: 953, state: "awaiting-ci", changed: ["lib/x.ts"] } }).ok, true);
  });

  test("a red pending ticket blocks the queue — the next session is its fix", () => {
    const r = canStartNext({ pending: { ticket: 953, state: "red", changed: ["lib/x.ts"] } });
    assert.equal(r.ok, false);
    assert.match(r.why, /#953/);
  });

  test("a dependency change drains before anything else starts", () => {
    const r = canStartNext({ pending: { ticket: 953, state: "awaiting-ci", changed: ["package.json", "lib/x.ts"] } });
    assert.equal(r.ok, false);
    assert.match(r.why, /node_modules|package\.json/);
  });

  test("package-lock.json counts the same as package.json", () => {
    assert.equal(canStartNext({ pending: { ticket: 953, state: "awaiting-ci", changed: ["package-lock.json"] } }).ok, false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement**

```js
// Worktrees isolate branches and indexes. They do not isolate node_modules — one install, shared
// through a junction — so a dependency change landing under a peer build is how that build gets a
// green typecheck against modules it does not have.
const SHARED_INSTALL = ["package.json", "package-lock.json"];

export function canStartNext({ pending }) {
  if (!pending) return { ok: true, why: "" };
  if (pending.state === "red") {
    return { ok: false, why: `#${pending.ticket} is red; the next session is its fix` };
  }
  const dep = (pending.changed ?? []).find((f) => SHARED_INSTALL.includes(f));
  if (dep) return { ok: false, why: `#${pending.ticket} changes ${dep}, and node_modules is shared` };
  return { ok: true, why: "" };
}
```

In `main()`: after a session pushes, record `pending = { ticket, pr, branch, changed, state: "awaiting-ci" }`
and start the CI wait as a promise rather than awaiting it. Before starting the next ticket, check
`canStartNext`; when it refuses, await the pending promise first. Merge strictly in the order tickets
were pushed. Print the supervisor's own `⏳`/`✅` lines through `closing()`, each naming its `#n`,
so two tickets' lines never read as one.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Commit**

```bash
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts
git commit -m "feat(loop): build the next ticket while the last one's CI runs"
```

---

## Task 10: The three spawn flags

**Files:**
- Create: `scripts/loop-tools.mjs`
- Modify: `scripts/queue-loop.mjs`
- Modify: `tests/loopDocsAreExecutable.test.ts`, `tests/queueLoop.test.ts`

**Interfaces:**
- Produces: `allowedTools(queueMdText: string): string[]`

- [ ] **Step 1: Write the failing test**

In `tests/loopDocsAreExecutable.test.ts`:

```ts
import { allowedTools } from "../scripts/loop-tools.mjs";

test("the --tools list is queue.md's own allowed-tools, parsed rather than copied", () => {
  const tools = allowedTools(read(QUEUE));
  assert.ok(tools.length >= 5, "allowed-tools frontmatter did not parse; the shape has drifted");
  assert.ok(tools.includes("Bash"));
  assert.ok(tools.includes("Task"), "phase B dispatches a subagent");
  assert.ok(tools.includes("Skill"), "phase C names two skills by name");
});
```

In `tests/queueLoop.test.ts`:

```ts
test("the spawn pins the version and keeps the prefix cacheable across tickets", () => {
  const args = queueLoopArgs();
  assert.ok(args.includes("--exclude-dynamic-system-prompt-sections"),
    "git status is part of the cached prefix, and the loop commits between tickets");
  assert.ok(args.includes("--tools"), "queue.md declares ten tools; without this the session loads all of them");
});
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement**

```js
// scripts/loop-tools.mjs
import { readFileSync } from "node:fs";

/**
 * `queue.md`'s `allowed-tools` frontmatter governs permission, not what is loaded, so a session
 * declaring ten tools still carries every one the build has — about 876 tokens each. Passing the
 * same list as `--tools` makes the declaration mean what it looks like it means.
 *
 * Parsed from the file rather than repeated here: a second copy of a list is a premise that decays.
 */
export function allowedTools(text) {
  const m = /^allowed-tools:\s*(.+)$/m.exec(text);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

export const readAllowedTools = (path = ".claude/commands/queue.md") =>
  allowedTools(readFileSync(path, "utf8"));
```

In `queueLoopArgs()`, append `"--exclude-dynamic-system-prompt-sections"` and
`"--tools", readAllowedTools().join(",")`.

Set `DISABLE_AUTOUPDATER: "1"` in the spawn's `env` (spread `process.env` first), with a comment:
an update landing mid-run changes the system prompt, which makes every remaining ticket of the
night a full-price cache miss, with nothing to see.

- [ ] **Step 4: Run both test files and watch them pass.**

- [ ] **Step 5: Verify `--tools` and `--exclude-dynamic-system-prompt-sections` are real flags on this build**

Run: `claude --help | grep -E "exclude-dynamic|^\s+--tools"`
If either is absent, run it anyway against a trivial prompt — `--max-turns` is documented and works
while being missing from this build's `--help`, so absence from help is not absence from the binary:

```bash
claude -p "reply with exactly the word: pong" --output-format stream-json --verbose \
  --exclude-dynamic-system-prompt-sections
```

A flag the binary rejects fails immediately with an "unknown option" error. If it does, drop that
flag and say so in the commit body — do not keep an argument the binary refuses.

- [ ] **Step 6: Commit**

```bash
git add -- scripts/loop-tools.mjs scripts/queue-loop.mjs tests/loopDocsAreExecutable.test.ts tests/queueLoop.test.ts
git commit -m "perf(loop): keep the prefix cacheable, pin the version, load the declared tools"
```

---

## Task 11: Measure the cache claim

**Files:** none — this task produces a finding, not a diff.

`--exclude-dynamic-system-prompt-sections` is doc-sourced and was never measured here. Task 6's row
already records `cache.created` and `cache.read`, so the measurement is a read, not an experiment.

- [ ] **Step 1: Run the loop for two tickets**

```bash
npm run queue:loop
```

Let two tickets finish, then `echo > .loop-stop` to drain.

- [ ] **Step 2: Read what the second ticket paid**

```bash
cat .loop-logs/tickets.jsonl | node -e "for await (const l of process.stdin) {}" # or simply:
node -e "require('fs').readFileSync('.loop-logs/tickets.jsonl','utf8').trim().split('\n').forEach(l=>{const r=JSON.parse(l);console.log(r.n, r.cache)})"
```

- [ ] **Step 3: Record the answer**

If the second ticket's `cache.created` is near zero, the flag does what the docs say and the row is
the evidence. If it is not, the flag does not help here: remove it from `queueLoopArgs()`, commit
that removal, and write what was measured on the pull request. Either outcome is the deliverable —
a flag kept because nobody checked is worse than no flag.

---

## Final: check, review, land

- [ ] **Run the local checks**

```bash
npm run agent:check
```

Say what it reported, including the checks it names as CI's. If it is red, fix and re-run — never
push a red check.

- [ ] **Review the diff** — `/code-review` scoped to the branch diff, before the push.

- [ ] **Push and open the pull request**

```bash
git push -u origin docs/queue-loop-observability
gh pr create --base main --head docs/queue-loop-observability --title "..." --body-file <file>
```

The body says what changed, how it is known, and what Task 11 measured. Write it with the Write tool
or a bash heredoc — `Set-Content` mangles every em-dash in it.

- [ ] **Read CI from run data, never by eye**

```bash
npx tsx lib/loop/ciVerdict.ts metasito/murlan docs/queue-loop-observability <pr>
```

- [ ] **Merge when green**

```bash
npx tsx lib/loop/land.ts metasito/murlan <pr>
```

---

## Self-review notes

**Spec coverage.** Observability spec: §1 defects → Tasks 3, 4, 5; §2 output → Tasks 2, 3, 6; §3
phase detection → Tasks 1, 3; §4 resilience → Tasks 4, 5 (spend ceiling is `--max-budget-usd 15`,
added in Task 10's `queueLoopArgs`); §5 `.loop-stop` → Task 5; §6 files → all; §7 tests → each task.
Cost spec: §1 → Task 8; §2 → Task 9; §3 → Task 6; §4 → Task 7; §5 → Tasks 10, 11; §6 board → Tasks
2, 9.

**Known gap, deliberate.** The `--max-budget-usd 15` from the observability spec §4 is added in Task
10 alongside the other spawn flags rather than in Task 4 where the rest of the resilience lives —
they are all arguments to the same function, and splitting them across two tasks would mean two
edits to `queueLoopArgs()` for no reviewer benefit.
