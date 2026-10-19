// tools/loop/tests/loopSession.test.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { runSession } from "../loop-session.mjs";
import { adoptingWorld, windowsWorld } from "../../../tests/helpers/processWorlds.ts";

// Its own directory, deleted after: the sink appends a real stream to the log it is handed.
const SCRATCH = path.join("tests", ".scratch-loop-session");

describe("runSession", () => {
  after(() => rmSync(SCRATCH, { recursive: true, force: true }));

  const RESULT = JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 1.82, num_turns: 41 });
  const phase = (letter: string) =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `PHASE ${letter}` }] } });
  const init = (model: string) => JSON.stringify({ type: "system", subtype: "init", session_id: "s", model });

  /** A `claude` that emits the given lines on stdout and then exits with `status`. */
  const fakeSpawn = (lines: string[], status: number | null = 0, errLines: string[] = []) => {
    const seen: { cmd: string; args: string[]; env: Record<string, string>; killed: string[] } = { cmd: "", args: [], env: {}, killed: [] };
    const spawnFn = (cmd: string, args: string[], o: any) => {
      Object.assign(seen, { cmd, args, env: o.env });
      const child: any = new EventEmitter();
      child.stdout = Readable.from(lines.map((l) => `${l}\n`));
      child.stderr = Readable.from(errLines.map((l) => `${l}\n`));
      child.kill = (sig: string) => seen.killed.push(sig);
      child.stdout.on("end", () => setImmediate(() => child.emit("close", status)));
      return child;
    };
    return { seen, spawnFn };
  };
  /** Each hand-made child gets a pid in a modelled table, so the signals `stopTree` sends reach its `kill`. */
  const opts = (extra: { spawnFn?: (...a: any[]) => any; [k: string]: unknown } = {}) => {
    const world = adoptingWorld();
    const { spawnFn } = extra;
    return {
      log: path.join(SCRATCH, "953.jsonl"),
      planned: "opus",
      proc: world.proc,
      ...extra,
      ...(spawnFn && { spawnFn: (...a: any[]) => world.adopt(spawnFn(...a)) }),
    };
  };

  test("spawns claude with the argv and env it is handed", async () => {
    const { seen, spawnFn } = fakeSpawn([RESULT]);
    await runSession(["-p", "/queue 953"], opts({ spawnFn, env: { LOOP_TICKET: "953" } }));
    assert.deepEqual([seen.cmd, seen.args, seen.env], ["claude", ["-p", "/queue 953"], { LOOP_TICKET: "953" }]);
  });

  test("hands each line's state and effects to onState, and resolves with the last state", async () => {
    const seen: [string | null, string[]][] = [];
    const { spawnFn } = fakeSpawn([phase("C"), RESULT]);
    const run = await runSession([], opts({ spawnFn, onState: (s: any, effects: any[]) => seen.push([s.phase, effects.map((e) => e.kind)]) }));
    assert.deepEqual(seen, [["C", ["start", "said"]], ["C", []]]);
    assert.equal(run.state.result.turns, 41);
    assert.deepEqual(Object.keys(run.state.phases), ["C"], "the phase it exited in is closed");
  });

  // `--model` passes an alias, and ANTHROPIC_DEFAULT_*_MODEL in the inherited or project env remaps it.
  test("an init model of another family than planned is killed; one of no known family is not", async () => {
    const wrong = fakeSpawn([init("claude-opus-5"), RESULT]);
    await runSession([], opts({ spawnFn: wrong.spawnFn, at: "E", planned: "sonnet" }));
    assert.deepEqual(wrong.seen.killed, ["SIGTERM"]);
    for (const model of ["claude-sonnet-5", "some-future-model"]) {
      const fine = fakeSpawn([init(model), RESULT]);
      await runSession([], opts({ spawnFn: fine.spawnFn, at: "E", planned: "sonnet" }));
      assert.deepEqual(fine.seen.killed, [], model);
    }
  });

  // `--settings` and `--setting-sources project` pin the plugins before the session starts.
  test("a plugin on the init line is never a reason to kill the session", async () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "claude-sonnet-5", plugins: [{ source: "ponytail@ponytail" }] });
    const session = fakeSpawn([line, RESULT]);
    const run = await runSession([], opts({ spawnFn: session.spawnFn, at: "E", planned: "sonnet" }));
    assert.deepEqual(session.seen.killed, []);
    assert.equal(run.status, 0);
  });

  // The budget message is the only place a budget stop is ever said: the result event for that
  // session still reads subtype "success".
  test("the child's stderr is captured and mirrored, not only inherited", async () => {
    const mirrored: string[] = [];
    const { spawnFn } = fakeSpawn([RESULT], 0, ["Budget limit reached ($15.08 of $15); stopping background agents."]);
    const run = await runSession([], opts({ spawnFn, onStderr: (c: string) => mirrored.push(c) }));
    assert.match(run.stderr, /Budget limit reached/);
    assert.match(mirrored.join(""), /Budget limit reached/);
  });

  test("a non-zero exit is reported, not thrown, and an exit with no status is a failure", async () => {
    assert.equal((await runSession([], opts({ spawnFn: fakeSpawn([RESULT], 1).spawnFn }))).status, 1);
    assert.equal((await runSession([], opts({ spawnFn: fakeSpawn([RESULT], null).spawnFn }))).status, 1);
  });

  test("a claude that cannot be spawned is a failed session, not a supervisor crash", async () => {
    const spawnFn = () => {
      const child: any = new EventEmitter();
      child.stdout = Readable.from([]);
      child.stderr = Readable.from([]);
      child.kill = () => {};
      setImmediate(() => {
        child.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
        child.emit("close", -4058);
      });
      return child;
    };
    const run = await runSession([], opts({ spawnFn }));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /spawn claude ENOENT/);
  });

  test("keeps the raw stream in the log it is handed, whole by the time it resolves", async () => {
    const log = path.join(SCRATCH, "999.jsonl");
    await runSession([], opts({ spawnFn: fakeSpawn([phase("B"), RESULT]).spawnFn, log }));
    assert.ok(readFileSync(log, "utf8").includes('"type":"result"'));
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
    const run = await runSession([], opts({ spawnFn: silent, stallMs: 20, tick: 10 }));
    assert.equal(run.status, "stalled");
    assert.equal(killed[0], "SIGTERM", "SIGTERM is what takes the child's Bash tree with it");
  });

  // `.loop-logs/1465.jsonl` lines 969–998: a phase D session whose last line is an `api_retry`, after
  // which the stream went silent until the watchdog killed it (K2).
  test("a session that stalls mid-retry keeps the retry as its last fact", async () => {
    const lines = readFileSync(path.join(import.meta.dirname, "fixtures", "api-retry-stall.jsonl"), "utf8").trim().split("\n");
    const replayed = () => {
      const child: any = new EventEmitter();
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      for (const l of lines) child.stdout.push(`${l}\n`);
      child.kill = () => {
        child.stdout.push(null);
        setImmediate(() => child.emit("close", null));
      };
      return child;
    };
    const run = await runSession([], opts({ spawnFn: replayed, at: "D", stallMs: 50, tick: 10 }));
    assert.equal(run.status, "stalled");
    assert.equal(run.state.lastFact, "api_retry");
  });

  // #1389 and #1268: the watchdog fired, then the run waited 92 and 260 min for a pipe a grandchild held.
  test("a stalled session whose pipes stay open after the kill still ends the run", async () => {
    const held = () => {
      const child: any = new EventEmitter();
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      child.kill = () => setImmediate(() => child.emit("exit", null));
      return child;
    };
    const run = await runSession([], opts({ spawnFn: held, stallMs: 20, tick: 10, killGraceMs: 20 }));
    assert.equal(run.status, "stalled");
  });

  describe("on win32", () => {
    const winOpts = (extra: object) => {
      const world = windowsWorld();
      return { world, o: { log: path.join(SCRATCH, "953.jsonl"), planned: "sonnet", proc: world.proc, spawnFn: world.spawn, killGraceMs: 20, ...extra } };
    };

    test("a session killed for its model leaves no descendant holding its stdout", async () => {
      const { world, o } = winOpts({ at: "E" });
      const spawnFn = (cmd: string, args: string[], so: object) => {
        const child = world.spawn(cmd, args, so);
        child.stdout.write(`${init("claude-opus-5")}\n`);
        return child;
      };
      const run = await runSession([], { ...o, spawnFn });
      assert.notEqual(run.status, 0);
      assert.deepEqual(world.alive(), []);
    });

    test("a stalled session leaves no descendant holding its stdout", async () => {
      const { world, o } = winOpts({ stallMs: 20, tick: 10 });
      const run = await runSession([], o);
      assert.equal(run.status, "stalled");
      assert.deepEqual(world.alive(), []);
    });
  });

  /** A child that says nothing until told to, and closes when killed. */
  const quiet = () => {
    const child: any = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.kill = () => {
      child.stdout.push(null);
      setImmediate(() => child.emit("close", null));
    };
    child.finish = (lines: string[]) => {
      for (const l of lines) child.stdout.push(`${l}\n`);
      child.stdout.push(null);
      setImmediate(() => child.emit("close", 0));
    };
    return child;
  };
  const HOURS_2 = 2 * 3_600_000;

  // Only `Date` is mocked: the watchdog's own interval stays real, as it does across a standby.
  test("a session the machine slept through is not stalled, and the sleep is booked as asleep", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const spawned = () => {
      const child = quiet();
      setTimeout(() => t.mock.timers.setTime(Date.now() + HOURS_2), 15);
      setTimeout(() => child.finish([RESULT]), 80);
      return child;
    };
    const run = await runSession([], opts({ spawnFn: spawned, tick: 10 }));
    assert.equal(run.status, 0, "a tick two hours late is the machine asleep, not the session silent");
    assert.equal(run.asleepMs, HOURS_2 - 10);
  });

  // #1466's parked row read 16:33Z for a session that started 13:39Z: it was dated now − ms, hours later.
  test("a session carries the instant it was spawned, which its ledger row is dated from", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-11T13:39:32Z") });
    const spawned = () => {
      const child = quiet();
      setTimeout(() => t.mock.timers.setTime(Date.now() + HOURS_2), 15);
      setTimeout(() => child.finish([RESULT]), 60);
      return child;
    };
    const run = await runSession([], opts({ spawnFn: spawned, tick: 10 }));
    assert.equal(run.started, "2026-10-11T13:39:32.000Z");
  });

  test("a hung session whose every tick arrives late is still killed", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const late = setInterval(() => t.mock.timers.setTime(Date.now() + HOURS_2), 5);
    try {
      const run = await Promise.race([
        runSession([], opts({ spawnFn: quiet, stallMs: 20, tick: 10 })),
        new Promise((r) => setTimeout(() => r({ status: "never killed" }), 2_000)),
      ]);
      assert.equal((run as { status: unknown }).status, "stalled");
    } finally {
      clearInterval(late);
    }
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
    const run = await runSession([], opts({ spawnFn: chatty, stallMs: 60, tick: 10 }));
    assert.deepEqual(killed, [], "a session still emitting is working, not stalled");
    assert.equal(run.status, 0);
  });
});
