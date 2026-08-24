// #293
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { classify, pickRoute, isInvokedDirectly } from "../scripts/next-ticket.mjs";

function issue(number: number, labelNames: string[]) {
  return { number, title: `issue ${number}`, labels: labelNames.map((name) => ({ name })) };
}

describe("classify's bucketing", () => {
  test("an unlabelled issue routes to triage, not to the owner", () => {
    const buckets = classify([issue(1, [])]);

    assert.deepEqual(buckets.owner, []);
    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 1);
  });

  test("an explicit needs-triage label still routes to triage", () => {
    const buckets = classify([issue(2, ["needs-triage"])]);

    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 2);
  });

  test("triage still precedes wayfinder when both have work", () => {
    // Precedence is deliberate, not incidental — per the ordering comment
    // above `classify`.
    const buckets = classify([issue(3, []), issue(4, ["wayfinder:research"])]);

    const route = pickRoute(buckets);
    assert.equal(route.skill, "triage");
    assert.equal(route.ticket.number, 3);
  });

  test("an owner-gated label still routes to owner", () => {
    const buckets = classify([issue(5, ["ready-for-human"])]);

    assert.equal(buckets.owner.length, 1);
    assert.equal(buckets.owner[0].number, 5);
  });

  test("ready-for-agent still wins over an unlabelled issue", () => {
    const buckets = classify([issue(6, ["ready-for-agent", "size:S"]), issue(7, [])]);

    assert.equal(buckets.frontier.length, 1);
    assert.equal(buckets.frontier[0].number, 6);
    assert.equal(buckets.triage.length, 1);
    assert.equal(buckets.triage[0].number, 7);
  });

  test("in-progress and blocked are still skipped regardless of other labels", () => {
    const buckets = classify([
      issue(8, ["in-progress"]),
      issue(9, ["ready-for-agent", "blocked"]),
    ]);

    assert.equal(buckets.frontier.length, 0);
    assert.equal(buckets.triage.length, 0);
    assert.equal(buckets.wayfinder.length, 0);
    assert.equal(buckets.owner.length, 0);
  });
});

describe("isInvokedDirectly", () => {
  test("is true only when argv1 resolves to the module's own path", () => {
    const self = path.resolve("scripts/next-ticket.mjs");
    const moduleUrl = pathToFileURL(self).href;

    assert.equal(isInvokedDirectly(self, moduleUrl), true);
    assert.equal(isInvokedDirectly(path.resolve("scripts/other.mjs"), moduleUrl), false);
    assert.equal(isInvokedDirectly(undefined, moduleUrl), false);
  });

  test("importing the module (not running it) never shells out to `gh`", (t) => {
    // PATH shimming can't be trusted here: a bare `execFileSync("gh", …)`
    // with no shell resolves through OS-level search rules that don't
    // reliably prefer a shadowing PATH entry (confirmed against the real
    // `gh` on this machine). Instead, patch `child_process.execFileSync`
    // itself in the child process before the import runs, so any call the
    // guard lets through is caught at the source, deterministically and
    // without ever touching the network.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-guard-"));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
    const marker = path.join(tmpDir, "called.txt");
    const preload = path.join(tmpDir, "preload.cjs");
    fs.writeFileSync(
      preload,
      [
        "const cp = require('node:child_process');",
        "const fs = require('node:fs');",
        "cp.execFileSync = function (file) {",
        "  fs.writeFileSync(process.env.GUARD_MARKER, String(file));",
        "  throw new Error('blocked: ' + file + ' must not run during import');",
        "};",
      ].join("\n"),
    );

    const moduleUrl = pathToFileURL(path.resolve("scripts/next-ticket.mjs")).href;
    // No `-e` argv[1], so isInvokedDirectly(undefined, moduleUrl) must be
    // false and the CLI body below must not run.
    const code = `import(${JSON.stringify(moduleUrl)}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });`;

    const start = Date.now();
    const result = spawnSync(process.execPath, ["--require", preload, "-e", code], {
      env: { ...process.env, GUARD_MARKER: marker },
      encoding: "utf8",
      timeout: 5000,
    });
    const elapsedMs = Date.now() - start;

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(marker), false, "importing the module must not shell out to `gh`");
    assert.ok(elapsedMs < 2000, `import took ${elapsedMs}ms — looks like it ran the CLI body`);
  });
});
