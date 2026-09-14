// tools/loop/tests/queueLoop.test.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { LAND } from "../loop-render.mjs";
import {
  parseRoute,
  pushedPr,
  shouldStop,
  queueLoopArgs,
  TURNS_BY_SIZE,
  TURNS_DEFAULT,
  liveRoute,
  syncCheckout,
  parseStatus,
  runTicket,
  ticker,
  park,
  shouldHalt,
  BREAKER,
  takeStopFile,
  settleOutcome,
  watchBuild,
  UNCOMMITTED_SHARE,
  outcomeOf,
  reasonFor,
  waitFor,
  afterRefusal,
  holdFor,
  WAIT,
  settle,
  runOnce,
  overHandoffs,
  MAX_HANDOFFS,
  overSpend,
  USD_BY_SIZE,
  USD_DEFAULT,
  watchCalls,
} from "../queue-loop.mjs";

/** Enough IO for `runOnce` to reach a decision without git, the tracker or a `claude` binary. */
const stubIo = () => ({
  stopFile: () => false,
  syncCheckout: () => true,
  queuePre: () => 0,
  pick: () => ({ skill: "implement", number: 42, title: "t", size: "size:S", queue: null }),
  spawn: async () => ({ status: 0, blocked: false, result: { cost: 1 }, ms: 1, log: "l", declared: null }),
  standing: () => null,
  pushedPr: () => null,
  settle: async () => ({ action: "merge", reason: "" }),
  park: () => {},
  teardown: () => {},
  bell: () => {},
  record: () => {},
  log: () => {},
});

describe("parseRoute", () => {
  test("reads the ROUTE line next-ticket.mjs prints", () => {
    const stdout = "ROUTE\timplement\t824\tFix the lamp swing\tsize:M\nSTATUS\timplement:3\ttriage:1\n";
    assert.deepEqual(parseRoute(stdout), {
      skill: "implement",
      number: 824,
      title: "Fix the lamp swing",
      size: "size:M",
    });
  });

  test("handles the handoff route, which carries no ticket", () => {
    const stdout = "ROUTE\thandoff\t0\tnothing agent-takeable\t\n";
    assert.deepEqual(parseRoute(stdout), {
      skill: "handoff",
      number: 0,
      title: "nothing agent-takeable",
      size: null,
    });
  });

  test("an unlabelled ticket reads as no size, not as the empty string", () => {
    assert.equal(parseRoute("ROUTE\timplement\t70\tx\t\n").size, null);
  });

  test("throws on output with no ROUTE line, rather than silently looping forever", () => {
    assert.throws(() => parseRoute("some unrelated error\n"), /no ROUTE line/);
  });
});

describe("queueLoopArgs", () => {
  test("runs /queue unattended, with no MCP tools an empty run could stall waiting on", () => {
    const args = queueLoopArgs(956);
    assert.ok(args.includes("-p"));
    assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
    assert.ok(args.includes("--strict-mcp-config"));
  });

  // The supervisor picked a ticket and then spawned a bare `/queue`, so the session picked again
  // seconds later. Two picks, no handoff, and `landed` compared against a number the session was
  // never told: #70 was reported landed with 34 files while the session resumed #955.
  test("the spawn carries the ticket number", () => {
    const args = queueLoopArgs(956);
    assert.equal(args[args.indexOf("-p") + 1], "/queue 956");
  });

  test("streams JSON, which print mode refuses without --verbose", () => {
    const args = queueLoopArgs(1);
    assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
    assert.ok(args.includes("--verbose"), "stream-json in print mode is refused without --verbose");
  });

  // A dollar cap is checked after a turn settles, so its stopping point moves with the model and
  // the context, and it resets on --resume. Turns are the bound that means something.
  test("bounds turns as well as dollars", () => {
    const args = queueLoopArgs(42, "size:S");
    assert.ok(args.includes("--max-turns"));
    assert.ok(args.includes("--max-budget-usd"));
  });

  const turns = (size: string | null) => {
    const args = queueLoopArgs(1, size);
    return Number(args[args.indexOf("--max-turns") + 1]);
  };

  test("a larger ticket gets more turns", () => {
    assert.ok(turns("size:L") > turns("size:S"), `got ${turns("size:L")} and ${turns("size:S")}`);
  });

  test("an unlabelled ticket still gets a bound", () => {
    assert.equal(turns(null), TURNS_DEFAULT);
    assert.ok(Number.isInteger(TURNS_DEFAULT) && TURNS_DEFAULT > 0);
  });

  test("every size the picker can emit has its own bound", () => {
    for (const size of ["size:XS", "size:S", "size:M", "size:L", "size:XL"]) {
      assert.ok((TURNS_BY_SIZE as Record<string, number>)[size] > 0, `${size} has no turn bound`);
    }
  });
});

describe("liveRoute", () => {
  test("no route when no ticket is live — the picker should run", () => {
    assert.equal(liveRoute({ onTicket: false }), null);
  });

  test("a clean derive off a ticket is still no route", () => {
    assert.equal(liveRoute({ onTicket: false, ambiguous: false, why: "not on an agent branch" }), null);
  });

  // locateRun refuses to guess between two live ticket worktrees, and that refusal is the whole
  // point of it. Returning null turned it into "no run is live" and the picker took a third.
  test("an ambiguous derive is a route, not an absence", () => {
    const r = liveRoute({ onTicket: false, ambiguous: true, why: "2 live agent/* worktrees" });
    assert.equal(r?.skill, "ambiguous");
    assert.match(r!.title, /2 live/);
  });

  test("resumes the live ticket instead of asking the picker for a new one", () => {
    assert.deepEqual(liveRoute({ onTicket: true, ticket: 911, branch: "agent/911-x", phase: "D" }), {
      skill: "implement",
      number: 911,
      title: "agent/911-x",
      phase: "D",
      resuming: true,
    });
  });

  test("falls back to a bare ticket label when derive() found no branch (the stuck/'?' case)", () => {
    assert.deepEqual(liveRoute({ onTicket: true, ticket: 911, branch: null, phase: "?" }), {
      skill: "implement",
      number: 911,
      title: "ticket #911",
      phase: "C",
      resuming: true,
    });
  });
});

describe("shouldStop", () => {
  test("stops on handoff", () => {
    assert.equal(shouldStop({ skill: "handoff" }), true);
  });

  for (const skill of ["implement", "triage", "wayfinder"]) {
    test(`keeps going on ${skill}`, () => {
      assert.equal(shouldStop({ skill }), false);
    });
  }
});

describe("syncCheckout", () => {
  const fake = (answers: Record<string, string>, fails?: string) => {
    const calls: string[][] = [];
    const git = (...args: string[]) => {
      calls.push(args);
      if (fails && args[0] === fails) throw new Error(`fatal: ${fails} refused`);
      const key = args.join(" ");
      for (const [k, v] of Object.entries(answers)) if (key.startsWith(k)) return v;
      return "";
    };
    return { git, calls };
  };
  const clean = { "rev-parse --abbrev-ref": "main", "status --porcelain": "" };

  test("a clean main fast-forwards and says nothing about drift", () => {
    const said: string[] = [];
    const { git, calls } = fake(clean);
    assert.equal(syncCheckout(git, (m: string) => said.push(m)), true);
    assert.ok(calls.some((c) => c[0] === "fetch"));
    assert.ok(calls.some((c) => c[0] === "merge"));
    assert.deepEqual(said, []);
  });

  // The loop's own tickets edit tools/loop/. Diffing it against origin/main called that drift on
  // every iteration; being behind is staleness, and staleness is repaired, not reported.
  test("being behind origin is not drift", () => {
    const said: string[] = [];
    syncCheckout(fake(clean).git, (m: string) => said.push(m));
    assert.equal(said.some((s) => /differs/.test(s)), false);
  });

  test("an uncommitted protocol edit on main refuses, and names the files", () => {
    const said: string[] = [];
    const { git, calls } = fake({
      "rev-parse --abbrev-ref": "main",
      "status --porcelain": " M tools/loop/queue-loop.mjs\n M .claude/commands/queue.md",
    });
    assert.equal(syncCheckout(git, (m: string) => said.push(m)), false);
    assert.match(said.join("\n"), /tools\/loop\/queue-loop\.mjs/);
    assert.match(said.join("\n"), /queue\.md/);
    assert.equal(calls.some((c) => c[0] === "merge"), false, "the ff-only merge is what refused and ended a run");
  });

  test("a foreign branch with its own commits refuses, and is not checked out of", () => {
    const said: string[] = [];
    const { git, calls } = fake({
      "rev-parse --abbrev-ref": "fix/loop-rate-limit-wait",
      "status --porcelain": "",
      "rev-list --count": "2",
    });
    assert.equal(syncCheckout(git, (m: string) => said.push(m)), false);
    assert.equal(calls.some((c) => c[0] === "checkout"), false);
    assert.match(said.join("\n"), /fix\/loop-rate-limit-wait is checked out with 2 commit/);
  });

  test("a leftover branch with nothing of its own is repaired, which is what this is for", () => {
    const { git, calls } = fake({
      "rev-parse --abbrev-ref": "agent/900-old",
      "status --porcelain": "",
      "rev-list --count": "0",
    });
    assert.equal(syncCheckout(git, () => {}), true);
    assert.ok(calls.some((c) => c[0] === "checkout" && c[1] === "main"));
  });

  test("a detached head refuses rather than checking main out from under it", () => {
    const said: string[] = [];
    const { git } = fake({ "rev-parse --abbrev-ref": "HEAD", "status --porcelain": "" });
    assert.equal(syncCheckout(git, (m: string) => said.push(m)), false);
    assert.match(said.join("\n"), /detached/);
  });

  test("a fast-forward that refuses is reported, not thrown", () => {
    const said: string[] = [];
    const { git } = fake(clean, "merge");
    assert.equal(syncCheckout(git, (m: string) => said.push(m)), false);
    assert.match(said.join("\n"), /cannot fast-forward main/);
  });
});

describe("parseStatus", () => {
  test("reads the bucket depths the picker prints beside the route", () => {
    const stdout = "ROUTE\timplement\t824\tx\nSTATUS\timplement:7\ttriage:2\twayfinder:1\towner:4\n";
    assert.deepEqual(parseStatus(stdout), { implement: 7, triage: 2, wayfinder: 1 });
  });

  test("no STATUS line reads as an empty queue rather than throwing", () => {
    assert.deepEqual(parseStatus("ROUTE\thandoff\t0\tnothing\n"), {
      implement: 0,
      triage: 0,
      wayfinder: 0,
    });
  });
});

// Its own directory, deleted after: `runTicket` appends a real stream to `<dir>/<n>.jsonl`, and the
// fixtures use live ticket numbers — so the suite was appending to the loop's own logs, every run.
const SCRATCH = path.join("tests", ".scratch-loop");

describe("runTicket", () => {
  after(() => rmSync(SCRATCH, { recursive: true, force: true }));

  /** A `claude` that emits the given lines on stdout and then exits with `status`. */
  const fakeSpawn = (lines: string[], status = 0, errLines: string[] = []) => () => {
    const child: any = new EventEmitter();
    child.stdout = Readable.from(lines.map((l) => `${l}\n`));
    child.stderr = Readable.from(errLines.map((l) => `${l}\n`));
    child.stdout.on("end", () => setImmediate(() => child.emit("close", status)));
    return child;
  };

  const phase = (letter: string) =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `PHASE ${letter}` }] } });

  const result = (over: object = {}) =>
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 1.82,
      num_turns: 41,
      duration_ms: 1000,
      usage: { cache_creation_input_tokens: 10, cache_read_input_tokens: 20 },
      ...over,
    });

  const RESULT = result();
  const facts = () => ({ title: "Rate limiter factory", url: "u", size: "size:S" });
  const queue = { implement: 1, triage: 0, wayfinder: 0 };
  /** A real ticker over a non-TTY stream: the lines the run would print, with no cursor control. */
  const sink = () => {
    const said: string[] = [];
    const out = { isTTY: false, write: (s: string) => said.push(s.trimEnd()) };
    return { said, screen: ticker(out as never, out as never) };
  };
  const opts = (extra: object = {}) => ({
    number: 953,
    queue,
    screen: sink().screen,
    facts,
    dir: SCRATCH,
    ...extra,
  });

  const meter = (status: string) =>
    JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status,
        resetsAt: 1789134000,
        rateLimitType: "five_hour",
        unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: 1789134000 } },
      },
    });

  test("subagents run in the foreground, so a poll turn is unreachable", async () => {
    let env: Record<string, string> | undefined;
    const capturing = (_cmd: string, _args: string[], o: any) => {
      env = o.env;
      const child: any = new EventEmitter();
      child.stdout = Readable.from([`${RESULT}\n`]);
      child.stderr = Readable.from([]);
      child.stdout.on("end", () => setImmediate(() => child.emit("close", 0)));
      return child;
    };
    await runTicket(capturing as never, opts());
    assert.equal(
      env?.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS,
      "1",
      "without it `-p` leaves fork mode off, subagents default to background, and the session polls them",
    );
  });

  test("a refusal reaches the caller, as milliseconds", async () => {
    const run = await runTicket(fakeSpawn([meter("rejected"), RESULT]), opts({ number: 962 }));
    assert.equal(run.blocked, true);
    assert.equal(run.blockedUntil, 1789134000000);
  });

  test("a healthy meter reading reaches it as nothing at all", async () => {
    const { said, screen } = sink();
    const run = await runTicket(
      fakeSpawn([meter("allowed"), meter("allowed_warning"), RESULT]),
      opts({ number: 962, screen }),
    );
    assert.equal(run.blocked, false);
    assert.equal(run.blockedUntil, 0);
    assert.doesNotMatch(said.join("\n"), /rate limited/, "a warning is still being served");
  });

  test("the phase comes from the session's own line", async () => {
    const { said, screen } = sink();
    const run = await runTicket(
      fakeSpawn([phase("A"), phase("C"), phase("E"), RESULT]),
      opts({ screen }),
    );
    const out = said.join("\n");
    assert.match(out, /✓ {2}claim/);
    assert.match(out, /✓ {2}build/);
    assert.match(out, /✓ {2}push/);
    assert.equal(run.phase, "E");
  });

  // `row()` has carried a `phases` field since the board was deleted and its only production
  // caller passed `{}` — a test proving the function can hold a value nothing ever gives it. The
  // durations exist here, in the one place that sees the markers arrive.
  test("times each phase, which is what the record is built from", async () => {
    const run = await runTicket(fakeSpawn([phase("A"), phase("C"), phase("F"), RESULT]), opts());
    assert.deepEqual(Object.keys(run.phases).sort(), ["A", "C", "F"]);
    for (const [letter, secs] of Object.entries(run.phases) as [string, number][]) {
      assert.ok(Number.isInteger(secs) && secs >= 0, `phase ${letter} timed as ${secs}`);
    }
  });

  // The marker is repeated on every message of a long phase, not only on the first.
  test("a phase said twice running is one phase, not two openings", async () => {
    const { said, screen } = sink();
    await runTicket(fakeSpawn([phase("C"), phase("C"), phase("C"), RESULT]), opts({ screen }));
    assert.equal(said.join("\n").match(/✓ {2}build/g)?.length, 1);
  });

  test("the session's closing declaration reaches the caller", async () => {
    const declare = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: 'LOOP-RESULT {"ticket":953,"branch":"agent/953-x","pr":1204,"phase":"F"}' }],
      },
    });
    const run = await runTicket(fakeSpawn([phase("F"), declare, RESULT]), opts());
    assert.equal(run.declared?.pr, 1204);
    assert.equal(run.declared?.branch, "agent/953-x");
  });

  // Sticky, it pre-empted everything else: a session refused at minute 2 that recovered and
  // pushed at minute 40 was reported refused, and its pull request was never looked for.
  test("a refusal the session recovers from does not survive to the caller", async () => {
    const run = await runTicket(fakeSpawn([meter("rejected"), meter("allowed"), RESULT]), opts({ number: 962 }));
    assert.equal(run.blocked, false);
    assert.equal(run.blockedUntil, 0);
  });

  // An hour of a healthy session printed nothing under the header: the board's only state was "a
  // phase is open", and the marker it waited for never parsed. The row exists before one arrives.
  test("the board is live before the session has named a phase", async () => {
    const { said, screen } = sink();
    await runTicket(fakeSpawn([RESULT]), opts({ screen }));
    assert.match(said.join("\n"), /✓ {2}\?/, "a session that named no phase left no row at all");
  });

  test("the first marker replaces that row rather than closing it as a phase", async () => {
    const { said, screen } = sink();
    await runTicket(fakeSpawn([phase("A"), RESULT]), opts({ screen }));
    const out = said.join("\n");
    assert.equal(out.match(/✓ {2}\?/g), null, "the placeholder was reported as a finished phase");
    assert.match(out, /✓ {2}claim/);
  });

  test("draws the header once", async () => {
    const { said, screen } = sink();
    await runTicket(fakeSpawn([phase("A"), phase("C"), RESULT]), opts({ screen }));
    assert.equal(said.join("\n").match(/#953 {2}Rate limiter factory/g)?.length, 1);
  });

  test("a resumed ticket says so, and does not read as a closed phase", async () => {
    const { said, screen } = sink();
    await runTicket(fakeSpawn([RESULT]), opts({ number: 962, at: "D", screen }));
    const rows = said.filter((l) => /↻ {2}review/.test(l));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /↻.*resumed/);
  });

  // The real turn carries `origin: null`; a background task's wake-up is a turn too and carries
  // origin.kind "task-notification". Last-wins across all of them reported 144 turns as one.
  test("a background task's result does not overwrite the session's", async () => {
    const wake = result({ num_turns: 1, total_cost_usd: 0, origin: { kind: "task-notification" } });
    const run = await runTicket(fakeSpawn([RESULT, wake]), opts());
    assert.equal(run.result?.turns, 41);
    assert.equal(run.result?.cost, 1.82);
  });

  test("carries the final result out, which is what the row and the closing line are built from", async () => {
    const run = await runTicket(fakeSpawn([phase("B"), RESULT]), opts());
    assert.equal(run.result?.cost, 1.82);
    assert.equal(run.result?.turns, 41);
    assert.deepEqual(run.result?.cache, { created: 10, read: 20 });
  });

  // The budget message is the only place a budget stop is ever said: the result event for that
  // session still reads subtype "success".
  test("the child's stderr is captured, not only inherited", async () => {
    const run = await runTicket(
      fakeSpawn([RESULT], 0, ["Budget limit reached ($15.08 of $15); stopping background agents."]),
      opts(),
    );
    assert.match(run.stderr, /Budget limit reached/);
  });

  test("a session that goes silent is killed and reported as stalled", async () => {
    const killed: string[] = [];
    const silent = () => {
      const child: any = new EventEmitter();
      // Never ends on its own: the watchdog is the only thing that can close this run.
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      child.kill = (sig: string) => {
        killed.push(sig);
        child.stdout.push(null);
        setImmediate(() => child.emit("close", null));
      };
      return child;
    };
    const run = await runTicket(silent, opts({ stallMs: 20, tick: 10 }));
    assert.equal(run.status, "stalled");
    assert.equal(killed[0], "SIGTERM", "SIGTERM is what takes the child's Bash tree with it");
  });

  test("a talking session is never killed, however long it runs", async () => {
    const killed: string[] = [];
    const chatty = () => {
      const child: any = new EventEmitter();
      const s = new Readable({ read() {} });
      child.stdout = s;
      child.stderr = new Readable({ read() {} });
      child.kill = (sig: string) => killed.push(sig);
      let n = 0;
      const timer = setInterval(() => {
        s.push(`${phase("C")}\n`);
        if (++n === 8) {
          clearInterval(timer);
          s.push(`${RESULT}\n`);
          s.push(null);
          setImmediate(() => child.emit("close", 0));
        }
      }, 5);
      return child;
    };
    const run = await runTicket(chatty, opts({ stallMs: 60, tick: 10 }));
    assert.deepEqual(killed, [], "a session still emitting is working, not stalled");
    assert.equal(run.status, 0);
  });

  test("a non-zero exit is reported, not thrown", async () => {
    const run = await runTicket(fakeSpawn([RESULT], 1), opts());
    assert.equal(run.status, 1);
  });

  test("keeps the raw stream in the log directory, the fallback for what the board omits", async () => {
    const run = await runTicket(fakeSpawn([phase("B"), RESULT]), opts({ number: 999 }));
    assert.match(run.log, /999\.jsonl$/);
    // Before the removal, and before anything else: every fixture here names a live ticket, so a
    // `dir` the callee quietly ignores has this line deleting a real night's stream log.
    assert.ok(
      path.resolve(run.log).startsWith(path.resolve(SCRATCH)),
      `runTicket wrote outside the scratch directory: ${run.log}`,
    );
    assert.ok(readFileSync(run.log, "utf8").includes('"type":"result"'));
    rmSync(run.log, { force: true });
  });
});

describe("park", () => {
  /** `stillDirty` is what `git status --porcelain` answers on the re-read before the commit. */
  const recorder = (throwOn?: string, stillDirty = " M a.ts") => {
    const calls: { file: string; args: string[] }[] = [];
    return {
      calls,
      run: (file: string, args: string[]) => {
        calls.push({ file, args });
        if (throwOn && args.includes(throwOn)) throw new Error(`${file} refused ${throwOn}`);
        return args.includes("--porcelain") ? stillDirty : "";
      },
    };
  };
  const ran = (calls: { file: string; args: string[] }[], needle: string) =>
    calls.some((c) => [c.file, ...c.args].join(" ").includes(needle));
  const opts = (extra: object) => ({
    phase: "C",
    why: "stalled",
    log: "x.jsonl",
    cwd: ".worktrees/agent-953",
    branch: "agent/953-x",
    dirty: false,
    write: () => {},
    ...extra,
  });

  test("commits the worktree's own dirty tree before removing it, so nothing is lost", () => {
    const { calls, run } = recorder();
    park(953, opts({ dirty: true, run }));
    const commitAt = calls.findIndex((c) => c.args.includes("commit"));
    const removeAt = calls.findIndex((c) => c.args.join(" ").includes("worktrees:remove"));
    assert.ok(commitAt !== -1, "a dirty worktree must be committed");
    assert.ok(removeAt > commitAt, "the worktree is removed only after its work is committed");
  });

  // `dirty` comes from a derive() up to twenty seconds old, so a session that committed in that
  // window leaves `git add -A` nothing to stage — and `git commit` then exits 1.
  test("a tree that went clean since the derive is not given an empty commit", () => {
    const { calls, run } = recorder(undefined, "");
    park(953, opts({ dirty: true, run }));
    assert.equal(calls.some((c) => c.args.includes("commit")), false);
  });

  test("takes ready-for-agent off as well as in-progress", () => {
    const { calls, run } = recorder();
    park(42, opts({ run, cwd: null }));
    const edit = calls.find((c) => c.args[0] === "issue" && c.args[1] === "edit");
    assert.ok(edit, "park edits the issue's labels");
    // Asserted as the whole argument list, not with `some(includes)`: the defect was a label that
    // was never removed, and a positive-only assertion cannot see an absent argument.
    assert.deepEqual([edit!.file, ...edit!.args], [
      "gh",
      "issue",
      "edit",
      "42",
      "--remove-label",
      "in-progress",
      "--remove-label",
      "ready-for-agent",
      "--add-label",
      "ready-for-human",
    ]);
  });

  test("the reason goes on the issue through a file, never an inline body", () => {
    const { calls, run } = recorder();
    park(953, opts({ run }));
    const comment = calls.find((c) => c.args.includes("comment"));
    assert.ok(comment, "park must comment on the issue");
    assert.ok(comment!.args.includes("--body-file"), "an inline --body is word-split and mojibaked");
    assert.ok(!comment!.args.includes("--body"), "an inline body loses the backticks a peer reads");
  });

  test("removes the worktree only through the named script, never git worktree remove", () => {
    const { calls, run } = recorder();
    park(953, opts({ run }));
    assert.ok(ran(calls, "worktrees:remove"));
    assert.ok(!ran(calls, "worktree remove"), "a recursive delete follows the node_modules junction");
  });

  test("the body it writes names the phase, the branch and the log", () => {
    let body = "";
    const { run } = recorder();
    park(953, opts({ run, write: (_p: string, text: string) => { body = text; } }));
    assert.match(body, /phase C/);
    assert.match(body, /agent\/953-x/);
    assert.match(body, /x\.jsonl/);
    assert.match(body, /stalled/);
  });

  // park is reached from the stop-file drain as well as from a bad session, so a throw here turned
  // an orderly stop into an unhandled rejection and lost whatever the run still held.
  test("a failing step is reported, not thrown", () => {
    const { run } = recorder("commit");
    const out = park(42, opts({ dirty: true, run, cwd: ".worktrees/agent-42" }));
    assert.equal(out.ok, false);
    assert.deepEqual(out.failed, ["commit"]);
  });

  test("still takes the label off when the comment fails", () => {
    const { calls, run } = recorder("comment");
    const out = park(42, opts({ run, cwd: null }));
    assert.ok(calls.some((c) => c.args[1] === "edit"), "the label edit happened");
    assert.deepEqual(out.failed, ["comment"]);
  });

  test("a clean park reports ok", () => {
    const { run } = recorder();
    assert.deepEqual(park(953, opts({ run })), { ok: true, failed: [] });
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
  test("absent means carry on", () => {
    assert.equal(takeStopFile({ existsSync: () => false }, ".loop-stop"), false);
  });

  // holdFor honoured it without consuming it and takeStopFile consumed it, so a stop during a wait
  // silently killed the next run too. A scheduled restart must see it as well.
  test("present means drain, and the file survives being read", () => {
    let removed = false;
    const fs = { existsSync: () => true, rmSync: () => { removed = true; } };
    assert.equal(takeStopFile(fs, ".loop-stop"), true);
    assert.equal(removed, false);
  });
});

describe("settleOutcome", () => {
  test("a merge is the landing, and costs the run nothing", () => {
    assert.deepEqual(settleOutcome({ action: "merge" }), {
      countsAsFailure: false,
      recorded: "landed",
      handBack: false,
    });
  });

  test("one already merged is a landing too, not a settle failure", () => {
    assert.equal(settleOutcome({ action: "already-merged" }).recorded, "landed");
  });

  // A ticket red three times produced three whole sessions and zero rows, so its cost, its turns
  // and the fact that it needed the rounds at all were absent from the file kept to measure them.
  test("a hand-back writes a row of its own, and does not count as a failure", () => {
    const out = settleOutcome({ action: "hand-back" });
    assert.equal(out.recorded, "retry");
    assert.equal(out.countsAsFailure, false);
    assert.equal(out.handBack, false);
  });

  // Recording the row and tearing the worktree down without releasing the claim leaves the issue
  // carrying `in-progress`, which classify() skips for good — a ticket nothing returns to.
  test("an owner decision is parked, and goes through park rather than a bare teardown", () => {
    const out = settleOutcome({ action: "owner" });
    assert.equal(out.countsAsFailure, true);
    assert.equal(out.recorded, "parked");
    assert.equal(out.handBack, true);
  });

  test("an unrecognised action parks rather than passing as a landing", () => {
    const out = settleOutcome({ action: "something-new" });
    assert.equal(out.countsAsFailure, true);
    assert.equal(out.handBack, true);
  });
});

describe("outcomeOf", () => {
  const open = { number: 984, state: "OPEN", head: "agent/42-x" };
  const fine = { why: null, hard: false };

  test("an open pull request is settled, not yet landed", () => {
    assert.deepEqual(outcomeOf({ pr: open, reason: fine }), { action: "settle", pr: 984 });
  });

  // A peer, an auto-merge or the owner between the session's exit and this read. Asked with
  // `--state open` this answered "pushed nothing" and false-parked a ticket that had landed.
  test("one merged while the supervisor was not looking is a landing", () => {
    const o = outcomeOf({ pr: { ...open, state: "MERGED" }, reason: fine });
    assert.equal(o.action, "landed");
    assert.equal(o.pr, 984);
  });

  test("one closed without merging is the owner's, and says so by number", () => {
    const o = outcomeOf({ pr: { ...open, state: "CLOSED" }, reason: fine });
    assert.equal(o.action, "park");
    assert.match(String(o.why), /#984 is closed/);
  });

  // The session stood down on a lost claim race, or derive() could not read the run. Both used to
  // read as "the worktree is gone, so it landed".
  test("no pull request and no reason is not landed either", () => {
    const o = outcomeOf({ pr: null, reason: fine });
    assert.equal(o.action, "park");
    assert.match(String(o.why), /pushed no pull request/);
  });

  // Eleven tickets whose pull requests merged were written down as parks, because how the session
  // ended was read before what it had already pushed.
  test("a soft reason never beats a pushed pull request", () => {
    const o = outcomeOf({ pr: open, reason: { why: "the session ran out of turns", hard: false } });
    assert.deepEqual(o, { action: "settle", pr: 984 });
  });

  test("a soft reason on a merged pull request is still a landing", () => {
    const o = outcomeOf({
      pr: { ...open, state: "MERGED" },
      reason: { why: "the session exited without a LOOP-RESULT", hard: false },
    });
    assert.equal(o.action, "landed");
  });

  test("a hard reason parks even over an open pull request, and keeps its number", () => {
    const o = outcomeOf({ pr: open, reason: { why: "the session stood down", hard: true } });
    assert.equal(o.action, "park");
    assert.equal(o.pr, 984);
    assert.match(String(o.why), /stood down/);
  });

  test("a soft reason is what a pull-request-less park is named after", () => {
    const o = outcomeOf({ pr: null, reason: { why: "the session ran out of turns", hard: false } });
    assert.equal(o.action, "park");
    assert.match(String(o.why), /out of turns/);
  });
});

describe("reasonFor", () => {
  const run = (over: object = {}) =>
    ({ status: 0, phase: "E", stderr: "", result: {}, declared: { pr: 9, stoodDown: false }, ...over }) as never;
  const after = { ticket: 42 };

  test("a finished session has no reason", () => {
    assert.deepEqual(reasonFor(run(), after, 42), { why: null, hard: false });
  });

  test("standing down is hard: the session's own branch is not this ticket's answer", () => {
    const r = reasonFor(run({ declared: { stoodDown: true, why: "lost the claim race" } }), after, 42);
    assert.equal(r.hard, true);
    assert.match(String(r.why), /claim race/);
  });

  test("a session that worked another ticket says so, and that is hard too", () => {
    const r = reasonFor(run(), { ticket: 955 }, 42);
    assert.equal(r.hard, true);
    assert.match(String(r.why), /worked #955, not #42/);
  });

  test("a budget stop is read from stderr, because the result still says success", () => {
    const r = reasonFor(run({ stderr: "Budget limit reached ($15.08 of $15)" }), after, 42);
    assert.match(String(r.why), /spent its budget/);
    assert.equal(r.hard, false);
  });

  test("running out of turns is named, and yields to a pushed branch", () => {
    const r = reasonFor(run({ result: { subtype: "error_max_turns" } }), after, 42);
    assert.match(String(r.why), /out of turns/);
    assert.equal(r.hard, false);
  });

  test("a stall names the ceiling it passed", () => {
    assert.match(String(reasonFor(run({ status: "stalled" }), after, 42).why), /no output for 30m/);
  });

  test("a non-zero exit names the phase", () => {
    assert.match(String(reasonFor(run({ status: 1 }), after, 42).why), /exited 1 in phase E/);
  });

  // Seventeen of nineteen sessions never emitted one, and the supervisor absorbed that silently by
  // inferring every fact about them from side effects phase F had just been told to delete.
  test("a clean exit with no LOOP-RESULT is an error, not a silent fallback", () => {
    const r = reasonFor(run({ declared: null }), after, 42);
    assert.match(String(r.why), /without a LOOP-RESULT/);
    assert.equal(r.hard, false);
  });

  test("no live ticket at all is not a reason on its own", () => {
    assert.deepEqual(reasonFor(run(), null, 42), { why: null, hard: false });
  });
});

describe("watchBuild", () => {
  const state = (over: object = {}) => ({
    phase: "C",
    buildTurns: 0,
    committed: false,
    warnedUncommitted: false,
    ...over,
  });
  const edits = { calls: [{ name: "Edit", command: "" }] };
  const commits = { calls: [{ name: "Bash", command: "git add -- a.ts && git commit -m 'x'" }] };
  const said: string[] = [];
  const warn = (m: string) => said.push(m);

  test("a commit in phase C is what it is watching for, and ends the watch", () => {
    const s = state();
    watchBuild(s, commits, 200, warn);
    assert.equal(s.committed, true);
    assert.equal(s.buildTurns, 0);
  });

  test("`git -C <dir> commit` counts, because that is how a worktree is committed to", () => {
    const s = state();
    watchBuild(s, { calls: [{ name: "Bash", command: "git -C .worktrees/agent-42 commit -m 'y'" }] }, 200, warn);
    assert.equal(s.committed, true);
  });

  test("a `git add` is not a commit — the one failed ticket made ten of them and no commits", () => {
    const s = state();
    watchBuild(s, { calls: [{ name: "Bash", command: "git add -- lib/x.ts" }] }, 200, warn);
    assert.equal(s.committed, false);
    assert.equal(s.buildTurns, 1);
  });

  test("it says so once, and only once, past its share of the budget", () => {
    const s = state();
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) watchBuild(s, edits, 100, (m) => lines.push(m));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /no commit/);
    assert.match(lines[0], /100-turn budget/);
  });

  test("the threshold moves with the budget, so an XS ticket is not warned on turn one", () => {
    const small = state();
    for (let i = 0; i < Math.round(60 * UNCOMMITTED_SHARE) - 1; i++) watchBuild(small, edits, 60, warn);
    assert.equal(small.warnedUncommitted, false);
    watchBuild(small, edits, 60, warn);
    assert.equal(small.warnedUncommitted, true);
  });

  test("phase D is not the build phase, and its turns are not counted against it", () => {
    const s = state({ phase: "D" });
    for (let i = 0; i < 500; i++) watchBuild(s, edits, 60, warn);
    assert.equal(s.buildTurns, 0);
    assert.equal(s.warnedUncommitted, false);
  });
});

/** Every way a wait goes wrong: waiting on nothing, for ever, on a passed reset, or on done work. */
describe("waitFor", () => {
  const now = 1_000_000_000_000;
  const mins = (n: number) => n * 60_000;

  test("a meter reading that is not a refusal waits for nothing", () => {
    assert.equal(waitFor({ blocked: false, blockedUntil: now + mins(300) }, now), 0);
  });

  test("a refusal waits until the reset, plus a small margin, and no longer", () => {
    const hold = waitFor({ blocked: true, blockedUntil: now + mins(265) }, now);
    assert.equal(hold, mins(265) + WAIT.MARGIN);
    assert.ok(WAIT.MARGIN <= mins(1), "the point is to resume almost as the window rolls over");
  });

  test("a reset that has already passed is not a wait — try again now", () => {
    assert.equal(waitFor({ blocked: true, blockedUntil: now - mins(5) }, now), 0);
  });

  test("a refusal naming no reset looks again shortly, rather than giving up", () => {
    assert.equal(waitFor({ blocked: true, blockedUntil: 0 }, now), WAIT.FLOOR);
  });

  // The cap bounds one hold, not the total: a seven-day window is waited out in pieces and asked
  // again, so the loop resumes within CAP of the reset rather than exiting the night.
  test("a reset a year out is held in one capped piece, not slept through", () => {
    const hold = waitFor({ blocked: true, blockedUntil: now + 365 * 24 * 60 * 60_000 }, now);
    assert.equal(hold, WAIT.CAP);
    assert.ok(WAIT.CAP >= mins(330), "the five-hour window must be waited out in one piece");
  });

  test("a session that got the work done does not wait, whatever the meter said", () => {
    assert.equal(waitFor({ blocked: true, blockedUntil: now + mins(300), done: true }, now), 0);
  });
});

describe("holdFor", () => {
  test("a stop file ends the wait, so .loop-stop still works during a long hold", async () => {
    assert.equal(await holdFor(60_000, () => true, 5), "stopped");
  });

  test("otherwise it waits the time out", async () => {
    assert.equal(await holdFor(10, () => false, 5), "waited");
  });

  // The hold is the one stretch of the run that prints nothing, and for up to twelve hours. A
  // silent terminal reads exactly like a dead one.
  test("a long hold says it is still there, and says when it is back", async () => {
    const said: string[] = [];
    await holdFor(60, () => false, 5, (m: string) => said.push(m), 10);
    assert.ok(said.length >= 3, `expected several heartbeats, saw ${said.length}`);
    assert.match(said[0], /still waiting — back at \d/);
  });

  test("a hold nobody is watching stays silent", async () => {
    assert.equal(await holdFor(30, () => false, 5, null, 10), "waited");
  });
});

describe("afterRefusal", () => {
  const now = 1_000_000_000_000;
  const base = { waits: 0, blocked: true, blockedUntil: now + 60_000 };

  test("a session that was not refused just proceeds", () => {
    const step = afterRefusal({ ...base, blocked: false }, now);
    assert.equal(step.action, "proceed");
    assert.equal(step.waits, 0);
  });

  test("a refusal waits and counts", () => {
    const step = afterRefusal(base, now);
    assert.equal(step.action, "wait");
    assert.equal(step.waits, 1);
    assert.ok(step.hold > 0);
  });

  // A hold of 0 is skipped entirely, so a refusal naming a reset already in the past — a clock
  // skew, a stale window, a seven-day limit reported with an expired short-window reset — spun
  // through twenty full `claude` spawns back to back, each paying its context creation.
  test("a window that has already reset still waits the floor, never nothing", () => {
    const step = afterRefusal({ ...base, blockedUntil: now - 1 }, now);
    assert.equal(step.action, "wait");
    assert.equal(step.hold, WAIT.FLOOR);
  });

  test("no refusal ever produces a hold of zero", () => {
    for (const blockedUntil of [0, now - 86_400_000, now - 1, now, now + 1, now + 600_000]) {
      const step = afterRefusal({ ...base, blockedUntil }, now);
      assert.ok(step.hold >= WAIT.FLOOR, `blockedUntil ${blockedUntil} held for ${step.hold}ms`);
    }
  });

  // A usage refusal is a property of the account. Keyed per ticket the counter was inert —
  // twenty tickets refused once each never reached the ceiling — and cruel when it did fire.
  test("the count is the run's, not the ticket's", () => {
    assert.equal(afterRefusal({ ...base, waits: 7 }, now).waits, 8);
  });

  test("refused past the ceiling gives up, and says what it tried", () => {
    const step = afterRefusal({ ...base, waits: WAIT.TRIES }, now);
    assert.equal(step.action, "give-up");
    assert.match(step.why ?? "", /refused 20 times running/);
    assert.match(step.why ?? "", /after waiting out the window/);
  });

  test("a session that pushed never waits, whatever the meter said", () => {
    assert.equal(afterRefusal({ ...base, done: true }, now).action, "proceed");
  });
});

// What this function returns reaches `gh pr merge --merge --delete-branch`, unattended. Every
// path through it therefore checks the head ref, including the one that trusts the number the
// session declared — a number a model wrote into a line of text.
describe("pushedPr only ever answers with this ticket's own pull request", () => {
  // Projected to the fields the call actually asked for, the way `gh` itself answers. A fake that
  // hands back the whole row lets a field dropped from `--json` pass every assertion below.
  const only = (row: object, args: string[]) => {
    const asked = (args[args.indexOf("--json") + 1] ?? "").split(",");
    return Object.fromEntries(Object.entries(row).filter(([k]) => asked.includes(k)));
  };
  const gh = (rows: object[], view: object | null = null) => {
    return (_cmd: string, args: string[]) =>
      args[1] === "view"
        ? JSON.stringify(view ? only(view, args) : {})
        : JSON.stringify(rows.map((r) => only(r, args)));
  };
  const open = {
    number: 984,
    state: "OPEN",
    headRefName: "agent/42-x",
    headRefOid: "5bb5dcf22b863994fc138ab773976e9539d78539",
    mergedAt: null,
  };

  test("the branch's own pull request is taken", () => {
    assert.deepEqual(pushedPr("agent/42-x", 42, null, 0, gh([open])), {
      number: 984,
      state: "OPEN",
      head: "agent/42-x",
      // The head the no-op-round guard in `main` is judged on. Asserted against a projecting fake,
      // so dropping `headRefOid` from the query reds this rather than answering null for ever.
      sha: "5bb5dcf22b863994fc138ab773976e9539d78539",
      changedFiles: 0,
    });
  });

  test("a pull request on another branch is not this ticket's, whatever gh returned", () => {
    const other = { number: 990, state: "OPEN", headRefName: "agent/77-y", mergedAt: null };
    assert.equal(pushedPr("agent/42-x", 42, null, 0, gh([other])), null);
    assert.equal(pushedPr(null, 42, null, 0, gh([other])), null);
  });

  test("a declared number is checked against the head ref like everything else", () => {
    const peer = { number: 1003, state: "OPEN", headRefName: "agent/891-rescue", mergedAt: null };
    assert.equal(
      pushedPr("agent/42-x", 42, 1003, 0, gh([], peer)),
      null,
      "a transposed number reached a peer's pull request",
    );
    const mine = { number: 1003, state: "OPEN", headRefName: "agent/42-x", mergedAt: null };
    assert.equal(pushedPr("agent/42-x", 42, 1003, 0, gh([], mine))?.number, 1003);
  });

  // A ticket re-opened and re-queued still has its old agent/<n>-… pull request on the tracker.
  // Read as a landing it releases the claim on a session that pushed nothing at all.
  test("a merge older than this session is not this session's landing", () => {
    const started = Date.UTC(2026, 8, 13, 9, 0);
    const oldRow = {
      number: 900,
      state: "MERGED",
      headRefName: "agent/42-x",
      mergedAt: new Date(started - 86_400_000).toISOString(),
    };
    assert.equal(pushedPr("agent/42-x", 42, null, started, gh([oldRow])), null);

    const freshRow = { ...oldRow, mergedAt: new Date(started + 60_000).toISOString() };
    assert.equal(pushedPr("agent/42-x", 42, null, started, gh([freshRow]))?.state, "MERGED");
  });

  test("gh failing is not a pull request", () => {
    const throws = () => {
      throw new Error("gh: not authenticated");
    };
    assert.equal(pushedPr("agent/42-x", 42, 1003, 0, throws), null);
  });
});

/**
 * The stretch after the session exits, which is the longest part of a ticket and the part the
 * board used to show nothing for: `close` ticked green and a twenty-minute CI wait read as a hang.
 */
describe("the land phase", () => {
  const board = () => {
    const rows: string[] = [];
    return {
      rows,
      start: (letter: string) => rows.push(`start ${letter}`),
      said: (text: string) => rows.push(`said ${text}`),
      close: (state: string, detail: string) => rows.push(`close ${state} ${detail}`),
    };
  };
  const pending = { ticket: 42, pr: 1049, branch: "agent/42-a-thing" };

  test("opens a phase before the wait and says what is being waited on", async () => {
    const screen = board();
    await settle(pending, screen as never, { watch: async () => ({ action: "merge" }) });
    assert.equal(screen.rows[0], `start ${LAND}`);
    assert.match(screen.rows[1], /waiting for ci\.yml on agent\/42-a-thing/);
  });

  test("a merge closes it green, naming the pull request that landed", async () => {
    const screen = board();
    await settle(pending, screen as never, { watch: async () => ({ action: "merge" }) });
    assert.equal(screen.rows.at(-1), "close done #1049 merged");
  });

  test("anything else closes it red, carrying the reason out to the row", async () => {
    const screen = board();
    const out = await settle(pending, screen as never, {
      watch: async () => ({ action: "owner", reason: "CI did not settle in 40m" }),
    });
    assert.equal(screen.rows.at(-1), "close failed CI did not settle in 40m");
    assert.equal(out.action, "owner", "the caller still decides; this only renders");
  });

  test("a wait that throws still settles the row, rather than spinning forever", async () => {
    const screen = board();
    await assert.rejects(() =>
      settle(pending, screen as never, {
        watch: async () => {
          throw new Error(["gh: rate limited", "second line"].join("\n"));
        },
      }),
    );
    assert.equal(screen.rows.at(-1), "close failed gh: rate limited");
  });

  test("what the wait says on the way reaches the board, not the scrollback", async () => {
    const screen = board();
    await settle(pending, screen as never, {
      watch: async (_p: unknown, log: (m: string) => void) => {
        log("main moved — updating the branch and reading CI again");
        return { action: "merge" };
      },
    });
    assert.ok(screen.rows.some((r) => r.startsWith("said main moved")));
  });
});

describe("a phase handoff", () => {
  test("a handoff re-spawns the same ticket instead of parking it", async () => {
    const spawned: number[] = [];
    const io = {
      ...stubIo(),
      pick: (pinned: number | null) => ({
        skill: "implement",
        number: pinned ?? 41,
        title: "t",
        size: "size:S",
        queue: null,
      }),
      spawn: (route: { number: number }) => {
        spawned.push(route.number);
        return Promise.resolve({
          status: 0,
          ms: 1,
          log: "x",
          result: { cost: 1 },
          declared: { ticket: 41, phase: "C", handoff: "D", stoodDown: false },
        });
      },
    };
    const pass = await runOnce(io as never, null, 0);
    assert.equal(pass.outcome, "handoff");
    assert.equal(pass.phase, "D");
    assert.deepEqual(spawned, [41]);
  });

  test("a handoff cannot run for ever", () => {
    assert.equal(overHandoffs(MAX_HANDOFFS), true);
    assert.equal(overHandoffs(MAX_HANDOFFS - 1), false);
  });

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
});

describe("watchCalls", () => {
  test("a turn making one Bash call and nothing else is counted", () => {
    const state = { soloBash: 0, turns: 0 };
    watchCalls(state, { calls: [{ name: "Bash", command: "git status" }] } as never);
    watchCalls(state, {
      calls: [{ name: "Bash", command: "ls" }, { name: "Bash", command: "pwd" }],
    } as never);
    watchCalls(state, { calls: [{ name: "Read", command: "" }] } as never);
    assert.equal(state.soloBash, 1);
    assert.equal(state.turns, 3);
  });

  test("a turn with no calls at all is not a turn that could have batched", () => {
    const state = { soloBash: 0, turns: 0 };
    watchCalls(state, { calls: [] } as never);
    assert.equal(state.turns, 0);
  });
});
