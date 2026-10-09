import { test } from "node:test";
import assert from "node:assert/strict";
import { awaitArtifact } from "../../tools/ci/await-artifact.mjs";

const APP = "Restore the app and bundle its JS";
const env = { GITHUB_REPOSITORY: "metasito/murlan", GITHUB_RUN_ID: "37985630688" };
const running = { name: APP, status: "in_progress", conclusion: null };

/** Each poll answers the jobs read, then the artifacts read, from the next of `polls`. */
async function poll(polls: { job: object; artifacts: string[] }[], tries = 10) {
  const routes: string[] = [];
  const lines: string[] = [];
  let sleeps = 0;
  let at = 0;
  const ghApi = (route: string) => {
    routes.push(route);
    const { job, artifacts } = polls[Math.min(at, polls.length - 1)];
    if (route.includes("/artifacts")) {
      at++;
      return JSON.stringify({ artifacts: artifacts.map((name) => ({ name, expired: false })) });
    }
    return JSON.stringify({ jobs: [job, { name: "Drive the app on a real iOS simulator (smoke)", status: "in_progress", conclusion: null }] });
  };
  const code = await awaitArtifact("ios-app", APP, env, ghApi, async () => void sleeps++, (l: string) => lines.push(l), tries);
  return { code, routes, lines, sleeps };
}

test("a shard waits while the app job runs, and goes on once its artifact is uploaded", async () => {
  const { code, routes, sleeps } = await poll([
    { job: running, artifacts: [] },
    { job: running, artifacts: ["felt-ios"] },
    { job: running, artifacts: ["ios-app"] },
  ]);
  assert.equal(code, 0);
  assert.equal(sleeps, 2);
  assert.deepEqual(routes.slice(0, 2), [
    "repos/metasito/murlan/actions/runs/37985630688/jobs?filter=latest&per_page=100",
    "repos/metasito/murlan/actions/runs/37985630688/artifacts?name=ios-app",
  ]);
});

test("an app job that ended without the artifact turns the shard red at once", async () => {
  const { code, lines, sleeps } = await poll([{ job: { name: APP, status: "completed", conclusion: "failure" }, artifacts: [] }]);
  assert.equal(code, 1);
  assert.equal(sleeps, 0);
  assert.match(lines.at(-1)!, /^::error::.*failure/);
});

test("an app job that finished and uploaded is ready, however the reads interleave", async () => {
  const { code } = await poll([{ job: { name: APP, status: "completed", conclusion: "success" }, artifacts: ["ios-app"] }]);
  assert.equal(code, 0);
});

test("a run with no such job, or an artifact that never comes, is red", async () => {
  assert.equal((await poll([{ job: { name: "build", status: "in_progress", conclusion: null }, artifacts: [] }])).code, 1);
  const never = await poll([{ job: running, artifacts: [] }], 3);
  assert.equal(never.code, 1);
  assert.equal(never.sleeps, 3);
  assert.match(never.lines.at(-1)!, /^::error::/);
});
