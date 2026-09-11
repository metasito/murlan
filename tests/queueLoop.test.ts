// tests/queueLoop.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { readFileSync, rmSync } from "node:fs";
import {
  parseRoute,
  shouldStop,
  queueLoopArgs,
  liveRoute,
  syncProtocol,
  advance,
  parseStatus,
  runTicket,
  stalled,
  STALL_MS,
  park,
  madeProgress,
  shouldHalt,
  BREAKER,
  takeStopFile,
  afterPush,
  canStartNext,
  mergeSlot,
  waitFor,
  afterRefusal,
  holdFor,
  WAIT,
} from "../scripts/queue-loop.mjs";

describe("parseRoute", () => {
  test("reads the ROUTE line next-ticket.mjs prints", () => {
    const stdout = "ROUTE\timplement\t824\tFix the lamp swing\nSTATUS\timplement:3\ttriage:1\n";
    assert.deepEqual(parseRoute(stdout), { skill: "implement", number: 824, title: "Fix the lamp swing" });
  });

  test("handles the handoff route, which carries no ticket", () => {
    const stdout = "ROUTE\thandoff\t0\tnothing agent-takeable\n";
    assert.deepEqual(parseRoute(stdout), { skill: "handoff", number: 0, title: "nothing agent-takeable" });
  });

  test("throws on output with no ROUTE line, rather than silently looping forever", () => {
    assert.throws(() => parseRoute("some unrelated error\n"), /no ROUTE line/);
  });
});

describe("queueLoopArgs", () => {
  test("runs /queue unattended, with no MCP tools an empty run could stall waiting on", () => {
    const args = queueLoopArgs();
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("/queue"));
    assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
    assert.ok(args.includes("--strict-mcp-config"));
  });

  test("streams JSON, which print mode refuses without --verbose", () => {
    const args = queueLoopArgs();
    assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
    assert.ok(args.includes("--verbose"), "stream-json in print mode is refused without --verbose");
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

describe("liveRoute", () => {
  test("no route when no ticket is live — the picker should run", () => {
    assert.equal(liveRoute({ onTicket: false }), null);
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
      // "?" is derive() saying it could not tell; the board starts at the build rather than lying.
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

describe("syncProtocol", () => {
  /** @param drifts one entry per `git diff` call, in order. */
  const fakeGit = (drifts: string[], fails?: string, head = { branch: "main", own: "0" }) => {
    const calls: string[][] = [];
    const git = (...args: string[]) => {
      calls.push(args);
      if (fails && args[0] === fails) throw new Error(`fatal: ${fails} refused`);
      if (args[0] === "diff") return drifts.shift() ?? "";
      if (args[0] === "rev-parse") return head.branch;
      if (args[0] === "rev-list") return head.own;
      return "";
    };
    return { git, calls };
  };
  const ran = (calls: string[][], verb: string) => calls.some((c) => c[0] === verb);

  test("fetches, and goes straight through when nothing drifted", () => {
    const { git, calls } = fakeGit([""]);
    assert.equal(syncProtocol(git, () => {}), true);
    assert.ok(ran(calls, "fetch"));
    assert.equal(ran(calls, "checkout"), false);
  });

  test("moves the checkout back to main when the protocol drifted", () => {
    const { git, calls } = fakeGit([".claude/commands/queue.md", ".claude/commands/queue.md", ""]);
    assert.equal(syncProtocol(git, () => {}), true);
    assert.deepEqual(
      calls.filter((c) => !["diff", "fetch", "rev-parse", "rev-list"].includes(c[0])),
      [
        ["checkout", "main"],
        ["merge", "--ff-only", "origin/main"],
      ]
    );
  });

  test("stops when git refuses the checkout, rather than running a stale protocol", () => {
    const { git } = fakeGit(["CLAUDE.md", "CLAUDE.md"], "checkout");
    const said: string[] = [];
    assert.equal(syncProtocol(git, (m: string) => said.push(m)), false);
    assert.match(said.join("\n"), /cannot restore main/);
  });

  test("stops when the drift survives the repair", () => {
    const { git } = fakeGit(["CLAUDE.md", "CLAUDE.md", "CLAUDE.md"]);
    assert.equal(syncProtocol(git, () => {}), false);
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

describe("runTicket", () => {
  /** A `claude` that emits the given lines on stdout and then exits with `status`. */
  const fakeSpawn = (lines: string[], status = 0) => () => {
    const child: any = new EventEmitter();
    child.stdout = Readable.from(lines.map((l) => `${l}\n`));
    child.stdout.on("end", () => setImmediate(() => child.emit("close", status)));
    return child;
  };

  const tool = (name: string, command: string, parent: string | null = null) =>
    JSON.stringify({
      type: "assistant",
      parent_tool_use_id: parent,
      message: { content: [{ type: "tool_use", id: "t", name, input: { command } }] },
    });

  const RESULT = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: 1.82,
    num_turns: 41,
    duration_ms: 1000,
    usage: { cache_creation_input_tokens: 10, cache_read_input_tokens: 20 },
  });

  const facts = () => ({ title: "Rate limiter factory", url: "u", size: "size:S" });
  const queue = { implement: 1, triage: 0, wayfinder: 0 };

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
    const run = await runTicket(fakeSpawn([meter("rejected"), RESULT]), {
      number: 962,
      queue,
      log: () => {},
      facts,
    });
    assert.equal(run.blocked, true);
    assert.equal(run.blockedUntil, 1789134000000);
  });

  test("a healthy meter reading reaches it as nothing at all", async () => {
    const said: string[] = [];
    const run = await runTicket(fakeSpawn([meter("allowed"), meter("allowed"), RESULT]), {
      number: 962,
      queue,
      log: (m: string) => said.push(m),
      facts,
    });
    assert.equal(run.blocked, false);
    assert.equal(run.blockedUntil, 0);
    assert.doesNotMatch(said.join("\n"), /rate limited/, "a healthy session must not be announced as throttled");
  });

  test("a resumed ticket draws its header at once, with no marker in the stream", async () => {
    const said: string[] = [];
    await runTicket(fakeSpawn([RESULT]), {
      number: 962,
      queue,
      at: "D",
      log: (m: string) => said.push(m),
      facts,
    });
    const out = said.join("\n");
    assert.match(out, /#962 · Rate limiter factory/);
    assert.match(out, /\[4\/6\] D/);
  });

  test("draws the header once and a line per phase it sees", async () => {
    const said: string[] = [];
    const run = await runTicket(
      fakeSpawn([
        tool("Bash", "gh issue edit 953 --add-label in-progress"),
        tool("Task", ""),
        RESULT,
      ]),
      { number: 953, queue, log: (m: string) => said.push(m), facts }
    );
    const out = said.join("\n");
    assert.equal(out.match(/#953 · Rate limiter factory/g)?.length, 1, "the header prints once");
    assert.match(out, /\[1\/6\] A/);
    assert.match(out, /\[2\/6\] B/);
    assert.equal(run.status, 0);
  });

  test("carries the final result out, which is what the row and the closing line are built from", async () => {
    const run = await runTicket(fakeSpawn([tool("Task", ""), RESULT]), {
      number: 953,
      queue,
      log: () => {},
      facts,
    });
    assert.equal(run.result?.cost, 1.82);
    assert.equal(run.result?.turns, 41);
    assert.deepEqual(run.result?.cache, { created: 10, read: 20 });
  });

  test("a subagent's own tool calls do not move the board — phase B is one phase", async () => {
    const said: string[] = [];
    await runTicket(
      fakeSpawn([
        tool("Task", ""),
        tool("Bash", "git push -u origin agent/953-x", "toolu_parent"),
        RESULT,
      ]),
      { number: 953, queue, log: (m: string) => said.push(m), facts }
    );
    assert.ok(!said.join("\n").includes("[5/6] E"), "a subagent cannot push the board to phase E");
  });

  test("a session that goes silent is killed and reported as stalled", async () => {
    const killed: string[] = [];
    const silent = () => {
      const child: any = new EventEmitter();
      // Never ends on its own: the watchdog is the only thing that can close this run.
      child.stdout = new Readable({ read() {} });
      child.kill = (sig: string) => {
        killed.push(sig);
        child.stdout.push(null);
        setImmediate(() => child.emit("close", null));
      };
      return child;
    };
    const run = await runTicket(silent, {
      number: 953,
      queue,
      log: () => {},
      facts,
      stallMs: 20,
      tick: 10,
    });
    assert.equal(run.status, "stalled");
    assert.equal(killed[0], "SIGTERM", "SIGTERM is what takes the child's Bash tree with it");
  });

  test("a talking session is never killed, however long it runs", async () => {
    const killed: string[] = [];
    const chatty = () => {
      const child: any = new EventEmitter();
      const s = new Readable({ read() {} });
      child.stdout = s;
      child.kill = (sig: string) => killed.push(sig);
      let n = 0;
      const timer = setInterval(() => {
        s.push(`${tool("Read", "")}
`);
        if (++n === 8) {
          clearInterval(timer);
          s.push(`${RESULT}
`);
          s.push(null);
          setImmediate(() => child.emit("close", 0));
        }
      }, 5);
      return child;
    };
    const run = await runTicket(chatty, {
      number: 953,
      queue,
      log: () => {},
      facts,
      stallMs: 60,
      tick: 10,
    });
    assert.deepEqual(killed, [], "a session still emitting is working, not stalled");
    assert.equal(run.status, 0);
  });

  test("a non-zero exit is reported, not thrown", async () => {
    const run = await runTicket(fakeSpawn([RESULT], 1), {
      number: 953,
      queue,
      log: () => {},
      facts,
    });
    assert.equal(run.status, 1);
  });

  test("keeps the raw stream in .loop-logs, which is the fallback for what the board omits", async () => {
    const run = await runTicket(fakeSpawn([tool("Task", ""), RESULT]), {
      number: 999,
      queue,
      log: () => {},
      facts,
    });
    assert.match(run.log, /999\.jsonl$/);
    assert.ok(readFileSync(run.log, "utf8").includes('"type":"result"'));
    rmSync(run.log, { force: true });
  });
});

describe("stalled", () => {
  test("silence past the ceiling is a stall", () => {
    assert.equal(stalled(0, STALL_MS + 1), true);
  });

  test("silence inside it is not — a CI wait is legitimately quiet for twenty minutes", () => {
    assert.equal(stalled(0, 20 * 60_000), false);
    assert.ok(STALL_MS > 20 * 60_000, "the ceiling must clear a real ciVerdict wait");
  });
});

describe("park", () => {
  const recorder = () => {
    const calls: { file: string; args: string[] }[] = [];
    return {
      calls,
      run: (file: string, args: string[]) => {
        calls.push({ file, args });
        return "";
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

  test("releases the claim and hands the ticket to the owner", () => {
    const { calls, run } = recorder();
    park(953, opts({ run }));
    assert.ok(ran(calls, "--remove-label in-progress"));
    assert.ok(ran(calls, "--add-label ready-for-human"));
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

  test("a clean worktree is not given an empty commit", () => {
    const { calls, run } = recorder();
    park(953, opts({ run }));
    assert.ok(!calls.some((c) => c.args.includes("commit")));
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
});

describe("madeProgress", () => {
  test("a first sighting of a ticket is progress", () => {
    assert.equal(madeProgress(null, { ticket: 953, head: "aaa", commits: 0 }), true);
  });

  test("a different ticket is progress", () => {
    assert.equal(
      madeProgress({ ticket: 953, head: "aaa", commits: 2 }, { ticket: 961, head: "aaa", commits: 2 }),
      true
    );
  });

  test("the same ticket with a new head is progress", () => {
    assert.equal(
      madeProgress({ ticket: 953, head: "aaa", commits: 2 }, { ticket: 953, head: "bbb", commits: 3 }),
      true
    );
  });

  test("the same ticket, same head, same commits is not — this is the loop resuming forever", () => {
    assert.equal(
      madeProgress({ ticket: 953, head: "aaa", commits: 2 }, { ticket: 953, head: "aaa", commits: 2 }),
      false
    );
  });

  test("a first commit on a branch that had none is progress, even with no head yet recorded", () => {
    assert.equal(
      madeProgress({ ticket: 953, head: null, commits: 0 }, { ticket: 953, head: "aaa", commits: 1 }),
      true
    );
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
});

describe("canStartNext", () => {
  test("nothing pending, so start", () => {
    assert.equal(canStartNext({ pending: null }).ok, true);
  });

  test("a pending ticket awaiting its first verdict does not block the next one", () => {
    assert.equal(
      canStartNext({ pending: { ticket: 953, state: "awaiting-ci", changed: ["lib/x.ts"] } }).ok,
      true
    );
  });

  // Red is `afterPush`'s call, not this one's: a drained ticket is no longer pending.
  test("a red verdict hands the ticket back for a fix rather than parking it", () => {
    const next = afterPush({ verdict: { pass: false, failedStep: "verify" } });
    assert.equal(next.action, "fix");
  });

  test("a green verdict that cannot merge parks, and says why", () => {
    const next = afterPush({ verdict: { pass: true }, landing: { action: "stop", reason: "CONFLICTING" } });
    assert.equal(next.action, "park");
    assert.match(next.why, /CONFLICTING/);
  });

  test("a dependency change drains before anything else starts", () => {
    const r = canStartNext({
      pending: { ticket: 953, state: "awaiting-ci", changed: ["package.json", "lib/x.ts"] },
    });
    assert.equal(r.ok, false);
    assert.match(r.why, /node_modules|package\.json/);
  });

  test("package-lock.json counts the same as package.json", () => {
    assert.equal(
      canStartNext({ pending: { ticket: 953, state: "awaiting-ci", changed: ["package-lock.json"] } }).ok,
      false
    );
  });

  test("a lockfile deep in a worktree path is not this repo's shared install", () => {
    assert.equal(
      canStartNext({ pending: { ticket: 953, state: "awaiting-ci", changed: ["docs/package.json"] } }).ok,
      true
    );
  });
});

/** One slot: it must be emptied before it is refilled, and a pushed ticket must give up its worktree. */
describe("mergeSlot", () => {
  const fakes = () => {
    const calls: string[] = [];
    const io = {
      settle: async (t: any) => {
        calls.push(`settle:${t.ticket}`);
        return { action: "merged", why: "merged" };
      },
      release: (cwd: string) => calls.push(`release:${cwd}`),
      reattach: (cwd: string) => calls.push(`reattach:${cwd}`),
      log: () => {},
    };
    return { calls, io };
  };

  test("a second ticket cannot take the slot until the first has settled", async () => {
    const { calls, io } = fakes();
    const slot = mergeSlot(io);

    await slot.adopt({ ticket: 953, cwd: ".worktrees/agent-953", at: Date.now() });
    await slot.adopt({ ticket: 961, cwd: ".worktrees/agent-961", at: Date.now() });

    assert.deepEqual(
      calls,
      ["release:.worktrees/agent-953", "settle:953", "release:.worktrees/agent-961"],
      "#953 must have been settled before #961 took the slot"
    );
    assert.equal(slot.pending.ticket, 961);
  });

  test("adopting reports what settled, so the caller can record it", async () => {
    const { io } = fakes();
    const slot = mergeSlot(io);
    await slot.adopt({ ticket: 953, cwd: "a", at: Date.now() });
    const settled = await slot.adopt({ ticket: 961, cwd: "b", at: Date.now() });
    assert.equal(settled?.ticket.ticket, 953);
    assert.equal(settled?.outcome.action, "merged");
  });

  test("a pushed ticket gives up its worktree, so nothing derives it as a live run", async () => {
    const { calls, io } = fakes();
    const slot = mergeSlot(io);
    await slot.adopt({ ticket: 953, cwd: ".worktrees/agent-953", at: Date.now() });
    assert.ok(calls.includes("release:.worktrees/agent-953"));
  });

  test("red CI gets the worktree back, because the next session is its fix", async () => {
    const { calls, io } = fakes();
    const slot = mergeSlot({ ...io, settle: async () => ({ action: "fix", why: "CI failed at verify" }) });
    await slot.adopt({ ticket: 953, cwd: ".worktrees/agent-953", branch: "agent/953-x", at: Date.now() });
    const settled = await slot.drain();
    assert.equal(settled?.outcome.action, "fix");
    assert.ok(calls.includes("reattach:.worktrees/agent-953"));
    assert.equal(slot.pending, null);
  });

  test("draining an empty slot is nothing, not a crash", async () => {
    const { io } = fakes();
    assert.equal(await mergeSlot(io).drain(), null);
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

  test("a refusal naming no reset looks again shortly, rather than parking the ticket", () => {
    assert.equal(waitFor({ blocked: true, blockedUntil: 0 }, now), WAIT.FLOOR);
  });

  test("a reset a year out is a bad field, not a year of sleep", () => {
    const hold = waitFor({ blocked: true, blockedUntil: now + 365 * 24 * 60 * 60_000 }, now);
    assert.equal(hold, WAIT.CAP);
    assert.ok(WAIT.CAP <= mins(360), "the longest window is five hours");
  });

  test("a session that got the work done does not wait, whatever the meter said", () => {
    assert.equal(waitFor({ blocked: true, blockedUntil: now + mins(300), done: true }, now), 0);
  });
});

describe("holdFor", () => {
  test("a stop file ends the wait, so .loop-stop still works during a five-hour hold", async () => {
    const out = await holdFor(60_000, () => true, 5);
    assert.equal(out, "stopped");
  });

  test("otherwise it waits the time out", async () => {
    assert.equal(await holdFor(10, () => false, 5), "waited");
  });
});

/** A background process may not move a checkout someone is working in. */
describe("syncProtocol leaves someone else's branch alone", () => {
  const fake = (branch: string, own: string) => {
    const calls: string[][] = [];
    const git = (...args: string[]) => {
      calls.push(args);
      if (args[0] === "diff") return "scripts/queue-loop.mjs";
      if (args[0] === "rev-parse") return branch;
      if (args[0] === "rev-list") return own;
      return "";
    };
    return { git, calls };
  };

  test("a branch with commits of its own stops the loop instead of being checked out of", () => {
    const { git, calls } = fake("fix/loop-rate-limit-wait", "1");
    const said: string[] = [];
    assert.equal(syncProtocol(git, (m: string) => said.push(m)), false);
    assert.equal(
      calls.some((c) => c[0] === "checkout"),
      false,
      "the loop must not move a branch it did not create"
    );
    assert.match(said.join("\n"), /fix\/loop-rate-limit-wait is checked out with 1 commit/);
  });

  test("a leftover branch with nothing of its own is still repaired, which is what this is for", () => {
    const { git, calls } = fake("agent/900-old", "0");
    syncProtocol(git, () => {});
    assert.ok(calls.some((c) => c[0] === "checkout" && c[1] === "main"));
  });

  test("drift on main itself is repaired, branch or no branch", () => {
    const { git, calls } = fake("main", "0");
    syncProtocol(git, () => {});
    assert.ok(calls.some((c) => c[0] === "checkout" && c[1] === "main"));
  });
});

describe("afterRefusal", () => {
  const now = 1_000_000_000_000;
  const base = { ticket: 962, waits: 0, waitsOn: null, blocked: true, blockedUntil: now + 60_000 };

  test("a session that was not refused just proceeds", () => {
    const step = afterRefusal({ ...base, blocked: false }, now);
    assert.equal(step.action, "proceed");
    assert.equal(step.waits, 0);
  });

  test("a refusal retries and counts", () => {
    const step = afterRefusal(base, now);
    assert.equal(step.action, "retry");
    assert.equal(step.waits, 1);
    assert.ok(step.hold > 0);
  });

  // A reset already passed means go now. Falling through to the ordinary accounting instead would
  // record a throttled session as "resumed with nothing committed" and count it toward the breaker.
  test("a window that has already reset retries with no wait at all", () => {
    const step = afterRefusal({ ...base, blockedUntil: now - 1 }, now);
    assert.equal(step.action, "retry");
    assert.equal(step.hold, 0);
  });

  test("a different ticket starts its own count", () => {
    const step = afterRefusal({ ...base, ticket: 970, waits: 19, waitsOn: 962 }, now);
    assert.equal(step.waits, 1);
    assert.equal(step.waitsOn, 970);
  });

  test("refused too often, it parks — and the reason survives into the row", () => {
    const step = afterRefusal({ ...base, waits: WAIT.TRIES, waitsOn: 962 }, now);
    assert.equal(step.action, "park");
    assert.match(step.why ?? "", /refused 20 times running/);
  });

  test("a session that pushed never waits, whatever the meter said", () => {
    assert.equal(afterRefusal({ ...base, done: true }, now).action, "proceed");
  });
});
