import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The dev preview's push hook is served by the workspace's own dev server, so
 * it answers only while the workspace is awake. Two things follow, and each is
 * a run of failures that already happened: booting has to sync, or a Repl that
 * slept through a push serves stale code until someone notices; and a stopped
 * workspace has to be told apart from a rejected push, or every overnight push
 * files a failure nobody can act on.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (...parts: string[]) =>
  readFileSync(path.join(repoRoot, ...parts), "utf8");

// What the workflow checks to tell a sleeping Replit from a real failure —
// see scripts/replitSyncVerdict.mjs (#905) for the branch itself.
const VERDICT_CHECK = 'if [ "$verdict" = stopped ]; then';

describe("the Replit workspace syncs to main when it boots", () => {
  const replit = readRepoFile(".replit");
  const scripts = JSON.parse(readRepoFile("package.json")).scripts as Record<string, string>;

  test("package.json runs the boot sync, and the script it names exists", () => {
    const command = scripts["dev:sync"];
    assert.ok(command, "package.json has no dev:sync script");

    const file = command.match(/\bscripts\/\S+/)?.[0];
    assert.ok(file, `dev:sync runs no script under scripts/: ${command}`);
    assert.ok(existsSync(path.join(repoRoot, file)), `dev:sync runs a missing file: ${file}`);
  });

  test("the boot sync reuses the hook's own sync rather than its own git", () => {
    const source = readRepoFile("scripts", "dev-boot-sync.ts");

    assert.match(source, /syncMain/, "dev-boot-sync.ts does not call syncMain");
    assert.doesNotMatch(
      source,
      /execFile|spawn|"git"/,
      "dev-boot-sync.ts runs git itself; syncMain is the one place that stashes first"
    );
  });

  test("the run button syncs before it starts anything", () => {
    const project = replit.slice(replit.indexOf('name = "Project"'));
    const app = project.slice(0, project.indexOf('name = "Start App"'));

    assert.match(app, /mode = "sequential"/, "the Project workflow does not run its tasks in order");

    const sync = app.indexOf("npm run dev:sync");
    const start = app.indexOf('args = "Start App"');
    assert.notEqual(sync, -1, "the Project workflow never runs npm run dev:sync");
    assert.notEqual(start, -1, "the Project workflow never starts the app");
    assert.ok(sync < start, "the app starts before the sync that is meant to precede it");
  });
});

describe("a sleeping workspace is not reported as a failing sync", () => {
  const workflow = readRepoFile(".github", "workflows", "replit-dev-sync.yml");

  test("a stopped-workspace verdict ends the run without filing anything", () => {
    const branch = workflow.slice(workflow.indexOf(VERDICT_CHECK));
    assert.notEqual(
      workflow.indexOf(VERDICT_CHECK),
      -1,
      "the workflow no longer branches on the stopped-workspace verdict"
    );
    assert.match(
      branch.slice(0, branch.indexOf("- name:")),
      /exit 0/,
      "the workflow recognises a stopped workspace but still fails the run"
    );
  });

  test("the verdict comes from the response, never a pipeline's exit status", () => {
    assert.doesNotMatch(
      workflow,
      /\|\s*grep -q/,
      "the guard reads a pipeline's exit status again, which is exactly how #905 went silently wrong"
    );
    assert.match(
      workflow,
      /node "\$GITHUB_WORKSPACE\/scripts\/replitSyncVerdict\.mjs"/,
      "the workflow no longer calls the falsifiable verdict script"
    );
  });

  test("the job checks out the repo it now runs a script from", () => {
    const send = workflow.slice(workflow.indexOf("jobs:"), workflow.indexOf("Send signed main push"));
    assert.match(
      send,
      /actions\/checkout@v\d/,
      "the job calls scripts/replitSyncVerdict.mjs but no longer checks out the repository"
    );

    const file = workflow.match(/\$GITHUB_WORKSPACE\/(scripts\/\S+\.mjs)/)?.[1];
    assert.ok(file, "the workflow no longer names a script path for the gate");
    assert.ok(existsSync(path.join(repoRoot, file!)), `the workflow calls a missing file: ${file}`);
  });

  test("a genuine failure's status reaches the issue it files, not just the run log", () => {
    const send = workflow.slice(workflow.indexOf("Send signed main push"));
    const body = send.slice(0, send.indexOf("- name:"));
    assert.match(
      body,
      /echo "HTTP \$http_code/,
      "the response status is captured but never written to the output the failing-sync issue quotes"
    );
  });

  test("only a real reply may close the failing-sync issue", () => {
    const close = workflow.slice(workflow.indexOf("Close the failing-sync issue"));
    const condition = close.match(/if: ([^\n]+)/)?.[1] ?? "";

    assert.match(
      condition,
      /outputs\.asleep != 'true'/,
      `a sleeping workspace would close an open failure: if: ${condition}`
    );
  });
});
