// tools/loop/tests/diagnose.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { diagnose, diagnosisArgs, diagnosisPrompt, parseDiagnosis } from "../diagnose.mjs";

describe("parseDiagnosis", () => {
  test("reads each action, and the cause up to the end of its paragraph", () => {
    assert.deepEqual(parseDiagnosis("…\nDIAGNOSIS: resume c\nCAUSE: tsc is red\nat two files."), {
      ok: true,
      action: "resume",
      phase: "C",
      cause: "tsc is red at two files.",
    });
    assert.deepEqual(parseDiagnosis("DIAGNOSIS: rerun\nCAUSE: a 403 from the artifact store", 7), {
      ok: true,
      action: "rerun",
      cause: "a 403 from the artifact store",
    });
    assert.equal(parseDiagnosis("DIAGNOSIS: park\nCAUSE: x").ok, true);
  });

  test("refuses what the loop cannot act on", () => {
    for (const text of ["", "CAUSE: x", "DIAGNOSIS: park", "DIAGNOSIS: resume G\nCAUSE: x", "DIAGNOSIS: rerun\nCAUSE: x", "DIAGNOSIS: fix it\nCAUSE: x"]) {
      assert.equal(parseDiagnosis(text, null).ok, false, text);
    }
  });
});

test("the session is Sonnet, read-mostly and bounded, and the prompt carries the stop", () => {
  const args = diagnosisArgs();
  const at = (flag: string) => args[args.indexOf(flag) + 1];
  assert.deepEqual([at("--model"), at("--tools"), at("--output-format")], ["sonnet", "Read,Grep,Glob,Bash", "json"]);
  assert.ok(Number(at("--max-turns")) > 0 && Number(at("--max-budget-usd")) > 0);
  const prompt = diagnosisPrompt({ ticket: 42, phase: "E", why: "CI failed at Browser test report", stderr: "boom", runId: 9 });
  for (const part of ["#42", "phase E", "CI failed at Browser test report", "CI run: 9", "boom", "DIAGNOSIS:", "CAUSE:"]) {
    assert.ok(prompt.includes(part), part);
  }
});

describe("diagnose", () => {
  const child = (stdout: string, status = 0) => {
    const c: any = new EventEmitter();
    c.stdout = new PassThrough();
    c.stderr = new PassThrough();
    c.stdin = new PassThrough();
    c.kill = () => {};
    setImmediate(() => {
      c.stdout.end(stdout);
      c.emit("close", status);
    });
    return c;
  };
  const reply = (result: string, over = {}) => JSON.stringify({ is_error: false, result, total_cost_usd: 0.4, num_turns: 7, ...over });
  const stop = { ticket: 42, phase: "E", why: "w", cwd: "w", runId: 9 };

  test("returns the decision with its cost", async () => {
    const d: any = await diagnose(stop, { spawnFn: () => child(reply("DIAGNOSIS: rerun\nCAUSE: 403")), state: () => "same" });
    assert.deepEqual([d.ok, d.action, d.cause, d.run.result], [true, "rerun", "403", { cost: 0.4, turns: 7 }]);
  });

  test("a session that changed the tree, errored or said nothing parseable is a failure", async () => {
    let reads = 0;
    const moved: any = await diagnose(stop, { spawnFn: () => child(reply("DIAGNOSIS: park\nCAUSE: x")), state: () => String(reads++) });
    assert.match(moved.error, /changed the worktree/);
    const errored: any = await diagnose(stop, { spawnFn: () => child(reply("", { is_error: true, subtype: "error_max_turns" })), state: () => "" });
    assert.match(errored.error, /error_max_turns/);
    const empty: any = await diagnose(stop, { spawnFn: () => child("", 1), state: () => "" });
    assert.match(empty.error, /exited 1 with no result/);
  });

  test("is not a queue session", async () => {
    let env: any = null;
    const spawnFn = (_c: string, _a: string[], o: any) => ((env = o.env), child(reply("x")));
    await diagnose(stop, { spawnFn: spawnFn as never, state: () => "" });
    assert.equal(env.LOOP_TURNS, undefined);
  });
});
