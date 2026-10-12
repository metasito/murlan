import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { commentReads, readIssue, untrustedRead } from "../../tools/loop/brief.mjs";

const DIRS = ["docs/agents", ".claude/commands"];

const docs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? docs(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : [],
  );

const untrusted = (text: string) => commentReads(text).filter(untrustedRead);

test("rule 25's read is the one the briefs use, which keeps only trusted authors' comments", () => {
  assert.ok(readFileSync("docs/agents/RULES.md", "utf8").includes(readIssue("<n>")));
});

test("every documented read of an issue's comments keeps only trusted authors'", () => {
  const files = DIRS.flatMap(docs);
  assert.ok(files.flatMap((f) => commentReads(readFileSync(f, "utf8"))).length > 0, "no comment read found; the pattern has drifted");
  assert.deepEqual(files.flatMap((f) => untrusted(readFileSync(f, "utf8")).map((a) => `${f}: gh ${a.join(" ")}`)), []);
});

test("the scan sees an unfiltered read, wrapped or not", () => {
  assert.equal(untrusted("gh issue view 5 --comments").length, 1);
  assert.equal(untrusted("gh pr view 5 \\\n  --json body,comments --jq '.comments[]'").length, 1);
  assert.equal(untrusted("`gh issue view 5 --json=title,comments`").length, 1);
  assert.equal(untrusted(readIssue(5)).length, 0);
  assert.equal(untrusted(readIssue(5).replace(" --jq", " \\\n  --jq")).length, 0);
});
