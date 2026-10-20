// tools/loop/tests/evidenceGuards.test.ts
//
// The loop's review evidence is the supervisor's: a session may not write the stream, the ledger or the
// reports the merge gate reads, and may not reach a merge or an unfiltered thread by a spelling the
// lexical guards skipped. Every block here ships with the bypass that motivated it.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { check } from "../guard-bash.mjs";
import { verdict } from "../guard-write.mjs";
import { ARTEFACTS, isEvidence } from "../loop-logs.mjs";
import { TRUSTED_SELECT } from "../tracker.mjs";

const scratch = mkdtempSync(path.join(tmpdir(), "evidence-guards-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const repo = {
  isRef: () => false,
  pathsClean: () => true,
  unmerged: () => false,
  top: () => scratch,
  cwd: () => scratch,
  onTicket: () => false,
};
const loop = (cmd: string) => check(cmd, repo, true);

const EVIDENCE = /record of what ran/;
const root = path.resolve("/repo");

describe("every artefact decides whether it is evidence", () => {
  for (const [kind, artefact] of Object.entries(ARTEFACTS)) {
    test(`${kind} declares it`, () => assert.equal(typeof (artefact as { evidence?: unknown }).evidence, "boolean"));
  }

  const evidence = Object.entries(ARTEFACTS).filter(([, a]) => (a as { evidence: boolean }).evidence);
  test("the stream, the ledger and the reports are the evidence", () => {
    assert.deepEqual(evidence.map(([k]) => k).sort(), ["ledger", "report", "stream"]);
  });

  for (const [kind, artefact] of evidence) {
    const name = path.basename(artefact.path("1"));
    test(`${kind} (${name}) is evidence`, () => assert.ok(isEvidence(name) && isEvidence(artefact.path("1"))));
    test(`${kind}: Write and Edit are denied`, () => {
      assert.match(String(verdict(path.join(root, ".loop-logs", name), root)), EVIDENCE);
      assert.match(String(verdict(path.join(".loop-logs", name), root, root)), EVIDENCE);
    });
    for (const cmd of [
      `echo x > .loop-logs/${name}`,
      `echo x >> .loop-logs/${name}`,
      `printf x | tee .loop-logs/${name}`,
      `cp /tmp/x .loop-logs/${name}`,
      `mv /tmp/x .loop-logs/${name}`,
      `sed -i s/a/b/ .loop-logs/${name}`,
      `truncate -s 0 .loop-logs/${name}`,
      `dd if=/tmp/x of=.loop-logs/${name}`,
      `cd .loop-logs && echo x > ${name}`,
      `node -e "require('fs').appendFileSync('.loop-logs/${name}', 'x')"`,
    ]) {
      test(`${kind}: ${cmd} is refused in the loop`, () => assert.match(String(loop(cmd)), cmd.startsWith("sed -i") ? /./ : EVIDENCE));
      test(`${kind}: ${cmd} is the owner's outside it`, () => assert.equal(check(cmd, repo, false), null));
    }
  }

  test("a scratch file in .loop-logs/ and a read of the record stay allowed", () => {
    for (const p of [path.join(root, ".loop-logs", "scratch.txt"), path.join(root, ".loop-logs", "pr-12.md"), path.join(root, ".worktrees", "agent-1", "1.jsonl")]) {
      assert.equal(verdict(p, root), null, p);
    }
    for (const cmd of ["cat .loop-logs/12.jsonl", "grep task .loop-logs/12.jsonl | head", "echo x > .loop-logs/scratch.txt", "echo x > docs/run-book.md", "echo x > $TMPFILE"]) {
      assert.equal(loop(cmd), null, cmd);
    }
  });

  for (const cmd of [
    "echo x > .loop-logs/*.jsonl",
    "rm .loop-logs/*",
    "n=12; echo x > .loop-logs/$n.jsonl",
    "f=tickets; echo x > .loop-logs/$f.jsonl",
    `python3 -c "open('.loop-logs/12.jsonl', 'w').write('x')"`,
    "Set-Content .loop-logs\\12.jsonl x",
    "Add-Content -Path .loop-logs\\tickets.jsonl -Value x",
    "cp -t .loop-logs /tmp/x.jsonl && cp /tmp/x .loop-logs/run-1.md",
    "bash -c 'echo x > .loop-logs/12.jsonl'",
  ]) {
    test(`a planted bypass is refused: ${cmd}`, () => assert.match(String(loop(cmd)), EVIDENCE));
  }
});

describe("the merge block sees past a lexical gh pr merge", () => {
  for (const cmd of [
    "pwsh -EncodedCommand ZwBoACAAcAByACAAbQBlAHIAZwBlAA==",
    "powershell -enc ZwBoAA==",
    "pwsh -ec ZwBoAA==",
    "pwsh -e ZwBoAA==",
    "pwsh -NoProfile -EncodedCommand ZwBoAA==",
  ]) {
    test(`refuses ${cmd}`, () => assert.match(String(check(cmd, repo)), /not yours to merge/));
  }

  const script = (name: string, body: string) => {
    writeFileSync(path.join(scratch, name), body);
    return name;
  };
  const merging = ["gh pr merge 5 --auto --merge\n", "gh api -X PUT repos/o/r/pulls/5/merge\n", "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'\n"];
  merging.forEach((body, i) => {
    const file = script(`m${i}.sh`, body);
    for (const run of [`bash ${file}`, `sh ./${file}`, `node ${file}`, `pwsh -File ${file}`, `pwsh ${file}`, `powershell -f ${file}`]) {
      test(`refuses ${run} for a script that merges (${i})`, () => assert.match(String(check(run, repo)), /not yours to merge/));
    }
  });

  test("a script that does not merge, or does not exist, is left alone", () => {
    const file = script("fine.sh", "echo hello\ngh pr view 5\n");
    for (const run of [`bash ${file}`, `node ${file}`, `pwsh -File ${file}`, "bash missing.sh", "node -e 'console.log(1)'"]) assert.equal(check(run, repo), null, run);
  });
});

describe("the thread-read block sees past gh issue view --comments", () => {
  for (const cmd of [
    "curl -s https://api.github.com/repos/metasito/murlan/issues/5/comments",
    "curl https://api.github.com/repos/metasito/murlan/pulls/5/reviews",
    "curl https://api.github.com/repos/metasito/murlan/issues/5/timeline",
    "irm https://api.github.com/repos/metasito/murlan/issues/5/comments",
    "iwr https://api.github.com/repos/metasito/murlan/pulls/5/comments",
    "Invoke-RestMethod https://api.github.com/repos/metasito/murlan/issues/5/comments",
    "gh api graphql -f query='{ repository(owner:\"o\", name:\"r\") { issue(number: 5) { comments(first: 50) { nodes { body } } } } }'",
    "gh api graphql -f query=x --jq '.data | " + TRUSTED_SELECT + "'",
    "gh pr view 5 --json reviews",
    "gh pr view 5 --json latestReviews",
    "gh pr view 5 --json number,timeline",
    "gh issue view 5 --json comments",
    "gh api repos/o/r/issues/5/timeline",
    "gh api repos/o/r/issues/5/comments --jq '.[].body' # " + TRUSTED_SELECT,
    "gh api repos/o/r/issues/5/comments --jq '.[].body' " + TRUSTED_SELECT,
    "gh pr view 5 --json comments --jq .comments " + TRUSTED_SELECT,
  ]) {
    test(`refuses in the loop: ${cmd}`, () => assert.match(String(loop(cmd)), /trusted-author filter/));
  }

  test("a read that keeps the trusted authors in --jq or -q is allowed", () => {
    for (const cmd of [
      `gh pr view 5 --json reviews --jq '.reviews[]|${TRUSTED_SELECT}|.body'`,
      `gh api repos/o/r/issues/5/timeline -q '.[]|${TRUSTED_SELECT}'`,
      `gh api repos/o/r/issues/5/comments --jq='.[]|${TRUSTED_SELECT}'`,
      "node tools/loop/tracker.mjs read 5",
      "curl -s https://api.github.com/repos/metasito/murlan/pulls/5",
      "gh pr view 5 --json number,title",
    ]) {
      assert.equal(loop(cmd), null, cmd);
    }
  });
});
