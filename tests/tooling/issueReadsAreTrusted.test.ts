import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readIssue, TRUSTED_SELECT } from "../../tools/loop/brief.mjs";

const DIRS = ["docs/agents", ".claude/commands"];

const docs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? docs(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : [],
  );

const commentReads = (text: string) =>
  text
    .replace(/\\\r?\n\s*/g, " ")
    .split("\n")
    .filter((l) => /gh (issue|pr) view\b/.test(l) && /--comments\b|--json\s+[\w,]*\bcomments\b/.test(l));

const untrusted = (text: string) => commentReads(text).filter((l) => !l.includes(TRUSTED_SELECT));

test("rule 25's read is the one the briefs use, which keeps only trusted authors' comments", () => {
  assert.ok(readFileSync("docs/agents/RULES.md", "utf8").includes(readIssue("<n>")));
});

test("every documented read of an issue's comments keeps only trusted authors'", () => {
  const files = DIRS.flatMap(docs);
  assert.ok(files.flatMap((f) => commentReads(readFileSync(f, "utf8"))).length > 0, "no comment read found; the pattern has drifted");
  assert.deepEqual(files.flatMap((f) => untrusted(readFileSync(f, "utf8")).map((l) => `${f}: ${l.trim()}`)), []);
});

test("the scan sees an unfiltered read, wrapped or not", () => {
  assert.equal(untrusted("gh issue view 5 --comments").length, 1);
  assert.equal(untrusted("gh pr view 5 --json body,comments \\\n  --jq '.comments[]'").length, 1);
  assert.equal(untrusted(readIssue(5)).length, 0);
});
