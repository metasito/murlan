// tools/loop/tests/evidenceGuards.test.ts
//
// The loop's review evidence is the supervisor's: a session may not write the stream, the ledger or the
// reports the merge gate reads, and may not reach a merge or an unfiltered thread by a spelling the
// lexical guards skipped. Every block here ships with the bypass that motivated it.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  read: (file: string): string => readFileSync(path.join(scratch, file), "utf8"),
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
    assert.deepEqual(evidence.map(([k]) => k).sort(), ["ledger", "report", "reportMac", "stream", "streamMac"]);
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

describe("the cheap bypasses of the same guards", () => {
  for (const cmd of [
    "echo x > .loop-logs/TICKETS.JSONL",
    "echo x > .loop-logs/Run-1.MD",
    "cp /tmp/1.jsonl .loop-logs/",
    "cp -t .loop-logs /tmp/12.jsonl",
    "cp --target-directory=.loop-logs /tmp/12.jsonl",
    "mv /tmp/x/*.jsonl .loop-logs",
    "cd .loop-logs && cp /tmp/12.jsonl .",
    "exec 3>> .loop-logs/12.jsonl",
    "echo x > .loop-logs/$(echo 12).jsonl",
    "echo x > .loop-logs/`echo 12`.jsonl",
    "python3 plant.py .loop-logs/12.jsonl",
    "perl -e 'open(F, \">>\", $ARGV[0])' .loop-logs/12.jsonl",
    "awk '{print > FILENAME}' .loop-logs/12.jsonl",
    "sed -e 's/a/b/;w .loop-logs/12.jsonl' /tmp/x",
    "echo x > .loop-logs/12.jsonl.mac",
    "echo x > .loop-logs/run-night.md.mac",
  ]) {
    test(`refuses in the loop: ${cmd}`, () => assert.match(String(loop(cmd)), EVIDENCE));
  }

  test("Write and Edit follow a link to the record, existing or not, and say any case", () => {
    const base = mkdtempSync(path.join(tmpdir(), "evidence-links-"));
    try {
      mkdirSync(path.join(base, ".loop-logs"));
      mkdirSync(path.join(base, ".worktrees"));
      symlinkSync(path.join(base, ".loop-logs", "tickets.jsonl"), path.join(base, ".loop-logs", "notes.txt"));
      symlinkSync(path.join(base, ".loop-logs"), path.join(base, ".worktrees", "logs"));
      symlinkSync(path.join(base, ".loop-logs", "3.jsonl"), path.join(base, ".worktrees", "dangling"));
      writeFileSync(path.join(base, ".loop-logs", "7.jsonl"), "");
      symlinkSync(path.join(base, ".loop-logs", "7.jsonl"), path.join(base, ".worktrees", "alias"));
      for (const p of [".loop-logs/notes.txt", ".worktrees/logs/9.jsonl", ".worktrees/dangling", ".worktrees/alias", ".loop-logs/TICKETS.JSONL", ".LOOP-LOGS/1.jsonl"]) {
        assert.match(String(verdict(path.join(base, p), base)), EVIDENCE, p);
      }
      assert.equal(verdict(path.join(base, ".loop-logs", "scratch.txt"), base), null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("the evidence key is named by no write", () => {
    assert.match(String(verdict(path.join(root, ".loop-logs", "evidence.key"), root)), /evidence key/);
    assert.match(String(loop("cat ~/.local/state/murlan-loop/evidence.key")), /evidence key/);
  });
});

describe("the merge block, beyond a script file", () => {
  const file = (name: string, body: string) => {
    writeFileSync(path.join(scratch, name), body);
    return name;
  };
  const target = file("target.sh", "gh pr merge 5 --auto\n");

  for (const cmd of ["pwsh --EncodedCommand ZwBo", "pwsh /EncodedCommand ZwBo", "pwsh /enc ZwBo", "pwsh -En ZwBo", "powershell --ec ZwBo"]) {
    test(`refuses ${cmd}`, () => assert.match(String(check(cmd, repo)), /not yours to merge/));
  }
  for (const cmd of [
    `bash -o pipefail ${target}`,
    `bash -x ./${target}`,
    `node --require ./x.js ${target}`,
    `source ${target}`,
    `. ./${target}`,
    `cat ${target} | bash`,
    `bash < ${target}`,
    `bash -s < ${target}`,
    "echo 'gh pr merge 5 --auto' | sh",
    "printf 'gh pr merge 5' | bash -s",
    "echo 'gh pr merge 5' > made.sh && bash made.sh",
    "printf 'gh pr merge 5' > made2.sh; sh ./made2.sh",
    "tee made3.sh < src.txt && source made3.sh",
  ]) {
    test(`refuses ${cmd}`, () => assert.match(String(check(cmd, repo)), /not yours to merge/));
  }

  test("a script it cannot read is refused, and one that is not a file is left alone", () => {
    const denied = () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    assert.match(String(check("bash locked.sh", { ...repo, read: denied })), /not yours to merge/);
    assert.equal(check("bash missing.sh", repo), null);
    assert.equal(check("node -e 'console.log(1)'", repo), null);
  });
});

describe("the trusted select is one canonical stage", () => {
  const read = (jq: string) => `gh api repos/o/r/issues/5/comments --jq '${jq}'`;
  for (const jq of [
    `.[]|${TRUSTED_SELECT} , .`,
    `.[]|${TRUSTED_SELECT} // .`,
    `if false then ${TRUSTED_SELECT} else . end`,
    `.[] | (${TRUSTED_SELECT}), .[]`,
    `.[]|select(.x)|${TRUSTED_SELECT}`,
    `.[]|${TRUSTED_SELECT.replace("COLLABORATOR", "NONE")}`,
    `.[]|${TRUSTED_SELECT}|map(.)|.[]`,
    `.[]|"${TRUSTED_SELECT}"`,
    `[.[]|${TRUSTED_SELECT}`,
  ]) {
    test(`refuses ${jq}`, () => assert.match(String(loop(read(jq))), /trusted-author filter/));
  }
  test("the canonical stage with plain paths around it is allowed", () => {
    for (const jq of [`.[]|${TRUSTED_SELECT}`, `.[]|${TRUSTED_SELECT}|.body`, `.comments[]|${TRUSTED_SELECT}|.user.login`]) assert.equal(loop(read(jq)), null, jq);
  });
});
