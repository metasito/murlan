// tools/loop/tests/loopStatus.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { report, silentAt, statusFor } from "../loop-status.mjs";
import { parityRed } from "../loop-derive.mjs";

const live = {
  onTicket: true,
  ticket: 42,
  branch: "agent/42-x",
  cwd: ".worktrees/agent-42",
  base: "origin/main",
  head: "abc1234",
  commits: 2,
  changed: ["a.ts"],
  dirty: false,
  phase: "C",
  why: "the supervisor handed this session phase C",
};

test("a reason the supervisor handed is printed under the phase", () => {
  const out = report(live, "phase E's agent:check was red");
  assert.match(out, /^ {2}resume at {2}C — Build\.[^\n]*\n {2}handed {5}phase E's agent:check was red$/m);
});

test("a HANDOFF on this head is printed, so the first command delivers it", () => {
  const out = report({ ...live, handoff: { line: "HANDOFF abc1234", notes: ["Read first: app/game.tsx:140-175"] } }, undefined);
  assert.match(out, /^ {2}handoff {4}HANDOFF abc1234$/m);
  assert.match(out, /^ {13}Read first: app\/game\.tsx:140-175$/m);
});

test("only a loop process's startup hook is silent", () => {
  const script = fileURLToPath(new URL("../loop-status.mjs", import.meta.url));
  const loop = { LOOP_TURNS: "60" };
  assert.equal(silentAt([process.execPath, script, "--startup"], loop), true);
  assert.equal(silentAt([process.execPath, script], loop), false);
  assert.equal(silentAt([process.execPath, script, "--startup"], {}), false);
  const run = spawnSync(process.execPath, [script, "--startup"], {
    encoding: "utf8",
    env: { ...process.env, ...loop, LOOP_GH_SCRIPT: "does-not-exist.mjs" },
  });
  assert.deepEqual([run.status, run.stdout], [0, ""]);
});

test("no reason, no line", () => {
  assert.doesNotMatch(report(live, undefined), /handed {5}/);
});

const IMPERATIVE = /\b(do not|don't|resume|resolve|must|re-plan|restart)\b/i;
const at = new Date("2026-09-22T01:02:03Z");

test("an interactive clear, compact or resume is told in one line, when it was derived, and ordered nothing", () => {
  const cases = [live, { ...live, phase: "?", why: "two heads" }, { onTicket: false, ambiguous: true, phase: "C", why: "two worktrees" }];
  for (const s of cases) {
    const out = statusFor(s, {}, at);
    assert.equal(out.split("\n").length, 1, out);
    assert.match(out, /derived 2026-09-22T01:02:03\.000Z/);
    assert.doesNotMatch(out, IMPERATIVE);
  }
  assert.match(statusFor(live, {}, at), /#42 is at phase C on `agent\/42-x`, in \.worktrees\/agent-42/);
  assert.equal(statusFor({ onTicket: false, phase: "C" }, {}, at), "");
});

const parity = { number: 1544, since: "2026-10-12T11:40:08Z" };
const PARITY = "parity nightly red since 2026-10-12 (#1544)";

test("an owner's session is told the nightly parity run is red, on the same one line", () => {
  for (const s of [{ onTicket: false, phase: "C" }, live]) {
    const out = statusFor(s, {}, at, parity);
    assert.equal(out.split("\n").length, 1, out);
    assert.ok(out.includes(PARITY), out);
    assert.doesNotMatch(out, IMPERATIVE);
  }
  assert.match(statusFor(live, {}, at, parity), /#42 is at phase C/);
  assert.equal(statusFor({ onTicket: false, phase: "C" }, {}, at, null), "");
  assert.ok(!statusFor(live, { LOOP_TURNS: "60" }, at, parity).includes("parity"), "a loop child is not the owner");
});

test("parityRed asks once for open parity issues and names the oldest; none or an unreadable tracker is null", () => {
  const asked: string[][] = [];
  const read = (args: string[]) => {
    asked.push(args);
    return JSON.stringify([
      { number: 1600, createdAt: "2026-10-20T00:00:00Z" },
      { number: 1544, createdAt: "2026-10-12T11:40:08Z" },
    ]);
  };
  assert.deepEqual(parityRed(read), parity);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].slice(0, 2), ["issue", "list"]);
  assert.equal(asked[0][asked[0].indexOf("--label") + 1], "parity");
  assert.equal(asked[0][asked[0].indexOf("--state") + 1], "open");
  assert.equal(parityRed(() => "[]"), null);
  const offline = () => {
    throw new Error("gh: could not connect");
  };
  assert.equal(parityRed(offline), null);
});

test("a loop child is still given the imperative", () => {
  assert.match(statusFor(live, { LOOP_TURNS: "60" }, at), /Resume where it says\. Do not re-plan/);
});

test("run by the hook outside a loop, whatever it derives, it prints at most one line and no order", () => {
  const script = fileURLToPath(new URL("../loop-status.mjs", import.meta.url));
  const env: NodeJS.ProcessEnv = { ...process.env, LOOP_GH_SCRIPT: "does-not-exist.mjs" };
  delete env.LOOP_TURNS;
  const run = spawnSync(process.execPath, [script], { encoding: "utf8", env });
  assert.equal(run.status, 0);
  assert.ok(run.stdout.trim().split("\n").length <= 1, run.stdout);
  assert.doesNotMatch(run.stdout, IMPERATIVE);
});
