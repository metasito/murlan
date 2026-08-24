// tests/ticketPipelineVerifyPlan.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickVerifyJobs } from "../lib/ticketPipeline/verifyPlan.ts";

describe("picking which ci.yml jobs a diff needs", () => {
  test("pipeline tooling skips the browser, native and build jobs", () => {
    const jobs = pickVerifyJobs([
      "lib/ticketPipeline/cleanup.ts",
      "tests/ticketPipelineCleanup.test.ts",
      ".claude/workflows/ticket-pipeline.mjs",
      "docs/agents/loops.md",
    ]);
    assert.deepEqual(jobs, { verify: true, native: false, browser: false, build: false, prose: false });
  });

  test("the verify job runs for every diff, so nothing lands untypechecked", () => {
    assert.equal(pickVerifyJobs(["docs/RULES.md"]).verify, true);
    assert.equal(pickVerifyJobs([]).verify, true);
  });

  test("a component change pulls the whole sweep", () => {
    const jobs = pickVerifyJobs(["components/CardFace.tsx"]);
    assert.deepEqual(jobs, { verify: true, native: true, browser: true, build: true, prose: false });
  });

  test("an unrecognised path fails safe towards running everything", () => {
    const jobs = pickVerifyJobs(["some/new/toplevel/thing.ts"]);
    assert.deepEqual(jobs, { verify: true, native: true, browser: true, build: true, prose: false });
  });

  test("an e2e spec pulls the browser job without pulling the build", () => {
    const jobs = pickVerifyJobs(["tests/e2e/tapTargets.spec.ts"]);
    assert.equal(jobs.browser, true);
    assert.equal(jobs.build, false);
  });

  test("a native spec pulls the native job without pulling the browser", () => {
    const jobs = pickVerifyJobs(["tests/native/a11yCollapse.test.tsx"]);
    assert.equal(jobs.native, true);
    assert.equal(jobs.browser, false);
  });

  test("a Windows-style path is still recognised as tooling", () => {
    assert.equal(pickVerifyJobs(["lib\\ticketPipeline\\gate.ts"]).browser, false);
  });

  test("one app file among tooling files is enough to pull the sweep", () => {
    const jobs = pickVerifyJobs([".claude/workflows/x.mjs", "server/socket.ts"]);
    assert.equal(jobs.build, true);
    assert.equal(jobs.browser, true);
  });
  test("a diff of only docs and markdown is prose, so a behaviour lens has nothing to review", () => {
    assert.equal(pickVerifyJobs(["docs/agents/loops.md", "CLAUDE.md"]).prose, true);
  });

  test("one executable file among the prose is enough to stop it counting as prose", () => {
    assert.equal(pickVerifyJobs(["docs/agents/loops.md", "lib/ticketPipeline/gate.ts"]).prose, false);
    assert.equal(pickVerifyJobs([".claude/workflows/ticket-pipeline.mjs"]).prose, false);
  });

  test("an empty file list is not prose, so an unknown diff never skips a lens", () => {
    assert.equal(pickVerifyJobs([]).prose, false);
  });
});
