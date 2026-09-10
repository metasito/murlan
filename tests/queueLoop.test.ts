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
    assert.deepEqual(liveRoute({ onTicket: true, ticket: 911, branch: "agent/911-x" }), {
      skill: "implement",
      number: 911,
      title: "agent/911-x",
      resuming: true,
    });
  });

  test("falls back to a bare ticket label when derive() found no branch (the stuck/'?' case)", () => {
    assert.deepEqual(liveRoute({ onTicket: true, ticket: 911, branch: null }), {
      skill: "implement",
      number: 911,
      title: "ticket #911",
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
  const fakeGit = (drifts: string[], fails?: string) => {
    const calls: string[][] = [];
    const git = (...args: string[]) => {
      calls.push(args);
      if (fails && args[0] === fails) throw new Error(`fatal: ${fails} refused`);
      return args[0] === "diff" ? (drifts.shift() ?? "") : "";
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
      calls.filter((c) => c[0] !== "diff" && c[0] !== "fetch"),
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
