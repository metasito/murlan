// tests/queueLoop.test.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  parseRoute,
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
  afterPush,
  settleOutcome,
  outcomeOf,
  reasonFor,
  waitFor,
  afterRefusal,
  holdFor,
  WAIT,
} from "../scripts/queue-loop.mjs";

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

  // The loop's own tickets edit scripts/. Diffing scripts/ against origin/main called that drift on
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
      "status --porcelain": " M scripts/queue-loop.mjs\n M .claude/commands/queue.md",
    });
    assert.equal(syncCheckout(git, (m: string) => said.push(m)), false);
    assert.match(said.join("\n"), /scripts\/queue-loop\.mjs/);
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
    assert.match(out, /\[1\/6\] A/);
    assert.match(out, /\[3\/6\] C/);
    assert.match(out, /\[5\/6\] E/);
    assert.equal(run.phase, "E");
  });

  test("draws the header once", async () => {
    const { said, screen } = sink();
    await runTicket(fakeSpawn([phase("A"), phase("C"), RESULT]), opts({ screen }));
    assert.equal(said.join("\n").match(/#953 · Rate limiter factory/g)?.length, 1);
  });

  test("a resumed ticket says so, and does not read as a closed phase", async () => {
    const { said, screen } = sink();
    await runTicket(fakeSpawn([RESULT]), opts({ number: 962, at: "D", screen }));
    const rows = said.filter((l) => l.includes("[4/6] D"));
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

  test("keeps the raw stream in .loop-logs, which is the fallback for what the board omits", async () => {
    const run = await runTicket(fakeSpawn([phase("B"), RESULT]), opts({ number: 999 }));
    assert.match(run.log, /999\.jsonl$/);
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

describe("afterPush", () => {
  test("green and clean merges", () => {
    const r = afterPush({ verdict: { pass: true }, landing: { action: "merge", reason: "CLEAN" } });
    assert.equal(r.action, "merged");
  });

  test("green but behind updates the branch first, and does not merge on the old verdict", () => {
    const r = afterPush({ verdict: { pass: true }, landing: { action: "update-branch", reason: "BEHIND" } });
    assert.equal(r.action, "update-branch");
  });

  test("red hands the ticket back to a session rather than parking it", () => {
    const r = afterPush({ verdict: { pass: false, failedStep: "lint", output: "..." } });
    assert.equal(r.action, "fix");
    assert.match(r.why, /lint/);
  });

  test("a job that ran zero steps says nothing about the diff, so it is asked again, not fixed", () => {
    const r = afterPush({ verdict: { pass: false, infrastructure: true } });
    assert.equal(r.action, "retry-verdict");
  });

  test("a conflicting branch parks — a merge that needs forcing is a decision", () => {
    const r = afterPush({
      verdict: { pass: true },
      landing: { action: "stop", reason: "the branch conflicts with main" },
    });
    assert.equal(r.action, "park");
    assert.match(r.why, /conflicts/);
  });

  test("infrastructure wins over a failed step: it says nothing about the diff either way", () => {
    const r = afterPush({ verdict: { pass: false, infrastructure: true, failedStep: "browser" } });
    assert.equal(r.action, "retry-verdict");
  });

  test("a recheck rides the retry budget instead of parking", () => {
    const out = afterPush({ verdict: { pass: true }, landing: { action: "recheck", reason: "still computing" } });
    assert.equal(out.action, "retry-verdict");
  });

  test("an already-merged pull request is a merge, not a park", () => {
    const out = afterPush({ verdict: { pass: true }, landing: { action: "already-merged", reason: "already merged" } });
    assert.equal(out.action, "merged");
  });
});

describe("settleOutcome", () => {
  test("a merge is the landing, and costs the run nothing", () => {
    assert.deepEqual(settleOutcome({ action: "merged" }), { countsAsFailure: false, recorded: "landed" });
  });

  test("a fix writes no row — the session that fixes it does", () => {
    assert.equal(settleOutcome({ action: "fix" }).recorded, null);
  });

  // park() adds ready-for-human and classify() sends any issue carrying an owner label to the
  // owner bucket, so every mechanical park was absorbing and the frontier drained 11 to 6.
  test("a mechanical failure counts toward the breaker and reaches no label", () => {
    const out = settleOutcome({ action: "park" });
    assert.equal(out.countsAsFailure, true);
    assert.equal(out.recorded, "stalled");
  });

  test("an unrecognised action still counts, rather than passing as a landing", () => {
    assert.equal(settleOutcome({ action: "something-new" }).countsAsFailure, true);
  });
});

describe("outcomeOf", () => {
  test("a pushed pull request is not yet landed", () => {
    assert.equal(outcomeOf({ pr: 984, why: null }).landed, false);
    assert.equal(outcomeOf({ pr: 984, why: null }).pushed, 984);
  });

  // The session stood down on a lost claim race, or derive() could not read the run. Both used to
  // read as "the worktree is gone, so it landed".
  test("no pull request and no reason is not landed either", () => {
    const o = outcomeOf({ pr: null, why: null });
    assert.equal(o.landed, false);
    assert.match(String(o.why), /pushed no pull request/);
  });

  test("a reason is never a landing", () => {
    const o = outcomeOf({ pr: 984, why: "the session exited 1 in phase C" });
    assert.equal(o.landed, false);
    assert.equal(o.pushed, undefined);
  });
});

describe("reasonFor", () => {
  const run = (over: object = {}) => ({ status: 0, phase: "E", stderr: "", result: {}, ...over });
  const after = { ticket: 42 };

  test("a finished session has no reason", () => {
    assert.equal(reasonFor(run(), after, 42), null);
  });

  test("a session that worked another ticket says so", () => {
    assert.match(String(reasonFor(run(), { ticket: 955 }, 42)), /worked #955, not #42/);
  });

  test("a budget stop is read from stderr, because the result still says success", () => {
    const r = reasonFor(run({ stderr: "Budget limit reached ($15.08 of $15)" }), after, 42);
    assert.match(String(r), /spent its budget/);
  });

  test("running out of turns is named", () => {
    assert.match(String(reasonFor(run({ result: { subtype: "error_max_turns" } }), after, 42)), /out of turns/);
  });

  test("a stall names the ceiling it passed", () => {
    assert.match(String(reasonFor(run({ status: "stalled" }), after, 42)), /no output for 30m/);
  });

  test("a non-zero exit names the phase", () => {
    assert.match(String(reasonFor(run({ status: 1 }), after, 42)), /exited 1 in phase E/);
  });

  test("no live ticket at all is not a reason on its own", () => {
    assert.equal(reasonFor(run(), null, 42), null);
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

  // A reset already passed means go now. Falling through to the ordinary accounting instead would
  // record a throttled session as a failed ticket and count it toward the breaker.
  test("a window that has already reset goes again with no wait at all", () => {
    const step = afterRefusal({ ...base, blockedUntil: now - 1 }, now);
    assert.equal(step.action, "wait");
    assert.equal(step.hold, 0);
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
