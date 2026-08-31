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

// The page Replit's edge serves for a workspace that is not running.
const ASLEEP_MARKER = "Run this app to see the results here";

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

  test("the placeholder page ends the run without filing anything", () => {
    const branch = workflow.slice(workflow.indexOf(ASLEEP_MARKER));
    assert.notEqual(
      workflow.indexOf(ASLEEP_MARKER),
      -1,
      "the workflow does not recognise Replit's stopped-workspace page"
    );
    assert.match(
      branch.slice(0, branch.indexOf("- name:")),
      /exit 0/,
      "the workflow recognises a stopped workspace but still fails the run"
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
