import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(repoRoot, "tools", "ci", "report-to-tracker.sh");

function report(title: string, open: { number: number; title: string }[]): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), "tracker-"));
  const log = path.join(dir, "calls.log");
  writeFileSync(path.join(dir, "list.json"), JSON.stringify(open));
  const gh = path.join(dir, "gh");
  writeFileSync(gh, `#!/usr/bin/env bash\nif [ "$2" = list ]; then cat "${dir}/list.json"; else echo "$*" >> "${log}"; fi\n`);
  chmodSync(gh, 0o755);
  const run = spawnSync("bash", [script, title, "body.md", "soak", "bug"], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return readFileSync(log, "utf8").trim().split("\n");
}

test("a red comments on the open issue of its own title", () => {
  const calls = report("The soak found something", [
    { number: 4, title: "The offline-match soak found something" },
    { number: 9, title: "The soak found something" },
  ]);
  assert.deepEqual(calls, ["issue comment 9 --body-file body.md"]);
});

test("a red whose title has no open issue files one, with every label", () => {
  const calls = report("The offline-match soak found something", [{ number: 9, title: "The soak found something" }]);
  assert.deepEqual(calls, ["issue create --title The offline-match soak found something --label soak --label bug --body-file body.md"]);
});
