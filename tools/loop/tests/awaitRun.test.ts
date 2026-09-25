import { test } from "node:test";
import assert from "node:assert/strict";
import { awaitRuns, BUDGET_MS } from "../await-run.mjs";
import { CHECK_BASH_TIMEOUT_MS } from "../queue-loop.mjs";

const quiet = () => {};
function clock() {
  let t = 0;
  return { now: () => t, pause: async (ms: number) => void (t += ms) };
}
const scripted = (seq: Record<string, object[]>) => (id: string) => (seq[id].length > 1 ? seq[id].shift()! : seq[id][0]);
const done = (conclusion: string) => ({ status: "completed", conclusion, workflowName: "iOS", url: "u" });
const going = { status: "in_progress", conclusion: "", workflowName: "iOS", url: "u" };

test("0 once every run succeeded, polling the one still going", async () => {
  const c = clock();
  const view = scripted({ 1: [going, going, done("success")], 2: [done("success")] });
  assert.equal(await awaitRuns(["1", "2"], { view, ...c, say: quiet }), 0);
  assert.equal(c.now(), 120_000);
});

test("1 as soon as one run failed, without waiting on the other", async () => {
  const c = clock();
  const view = scripted({ 1: [going], 2: [done("failure")] });
  assert.equal(await awaitRuns(["1", "2"], { view, ...c, budgetMs: 120_000, say: quiet }), 1);
  assert.equal(c.now(), 0);
});

test("a cancelled run is not a pass", async () => {
  assert.equal(await awaitRuns(["1"], { view: () => done("cancelled"), ...clock(), say: quiet }), 1);
});

test("3 before the budget runs out, saying to run it again", async () => {
  const c = clock();
  const said: string[] = [];
  assert.equal(await awaitRuns(["1"], { view: () => going, ...c, budgetMs: 300_000, say: (s: string) => said.push(s) }), 3);
  assert.ok(c.now() <= 300_000);
  assert.match(said.join("\n"), /run the same command again/i);
});

test("a gh failure counts as still going, not as a crash", async () => {
  const c = clock();
  let calls = 0;
  const view = () => {
    if (calls++ === 0) throw new Error("HTTP 502");
    return done("success");
  };
  assert.equal(await awaitRuns(["1"], { view, ...c, say: quiet }), 0);
});

test("the default budget leaves a poll's headroom under the Bash ceiling", () => {
  assert.ok(BUDGET_MS + 2 * 60_000 <= CHECK_BASH_TIMEOUT_MS);
});
