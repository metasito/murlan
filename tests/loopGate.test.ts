// tests/loopGate.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { readFields, check, protectedHits } from "../scripts/loop-gate.mjs";
import { brief } from "../scripts/loop-brief.mjs";

const FILLED = `# LOOP STATE

status: RUNNING
ticket: 824
branch: agent/824-music-delay

## Evidence
dod:
  - [ ] the delay is measured on device
  - [ ] a regression test pins it
recon: components/audio.ts, lib/sound.ts
verdict: VERDICT: LAND
gate:
`;

describe("the loop's evidence gate", () => {
  test("a filled state passes", () => {
    assert.deepEqual(check(readFields(FILLED)).blank, []);
  });

  test("a phase that never ran leaves its field blank, and is named", () => {
    const { blank } = check(readFields(FILLED.replace("recon: components/audio.ts, lib/sound.ts", "recon:")));
    assert.equal(blank.length, 1);
    assert.match(blank[0], /^recon: phase B never ran/);
  });

  // The failure this whole file exists for: the template ships every field carrying a `# hint`
  // comment, and reading that as content would call a run that did nothing complete.
  test("a template hint is not evidence", () => {
    const fields = readFields(`status: RUNNING\nticket: 1\nbranch: b\ndod:\nrecon:   # B: files to touch\nverdict:\n`);
    assert.equal(fields.recon, "");
    assert.deepEqual(
      check(fields).blank.map((b) => b.split(":")[0]),
      ["dod", "recon", "verdict"],
    );
  });

  test("a HOLD blocks the push even though phase D ran", () => {
    const { blank, held } = check(readFields(FILLED.replace("VERDICT: LAND", "VERDICT: HOLD — the guard exempts its own case")));
    assert.deepEqual(blank, []);
    assert.equal(held, true);
  });

  // The shipped template must be the shape the gate reads, or the gate is checking a file
  // nothing writes. It ships IDLE, so only its field names are asserted here.
  test("the committed STATE.md carries every field the gate requires", () => {
    const fields = readFields(readFileSync(".claude/loop/STATE.md", "utf8"));
    for (const key of ["status", "ticket", "branch", "dod", "recon", "verdict"]) {
      assert.ok(key in fields, `.claude/loop/STATE.md has no \`${key}\` field`);
    }
  });
});

// The hook this guards was a POSIX one-liner until PowerShell — this machine's primary shell —
// was found to reject it with a parser error, leaving the loop with no recovery from a
// compaction and no sign that anything was wrong. Hence a node script, and hence these.
describe("the compaction brief", () => {
  test("says nothing when no run is live", () => {
    assert.equal(brief("status: IDLE\nticket:\n", "a lesson"), "");
    assert.equal(brief("", ""), "");
  });

  test("carries the state and the lessons into a session that lost them", () => {
    const out = brief(FILLED, "- never trust a green suite nobody ran");
    assert.match(out, /do not\s+restart the ticket/);
    assert.match(out, /agent\/824-music-delay/);
    assert.match(out, /never trust a green suite/);
  });

  // `status:` is matched per line, so a run is live only when the field says so — not when the
  // word appears in a phase note or a lesson.
  test("a mention of RUNNING is not a live run", () => {
    assert.equal(brief("status: HALTED\nphase_note: was RUNNING when CI went red\n", ""), "");
  });
});

// CLAUDE.md said "never autonomously change" these; the command file said the same work was fine
// once a decision was recorded somewhere. Both could not be followed, and neither was executable.
// The list is now one list, and it runs.
describe("the protected paths", () => {
  test("a clean branch touching none of them is not blocked", () => {
    assert.deepEqual(protectedHits("HEAD"), []);
  });

  test("the check reads the real diff rather than trusting a claim", () => {
    // Against the merge-base of this branch, this run's own diff is the fixture: it changes the
    // gate and the loop's docs, and none of the protected paths.
    const hits = protectedHits("origin/main");
    assert.deepEqual(
      hits.filter((f) => f.startsWith("shared/") || f.startsWith(".github/")),
      [],
      `this branch should not be touching protected paths, but reports: ${hits.join(", ")}`
    );
  });

  // The floor. Every assertion above passes just as happily on a check that never fires, which is
  // the failure mode this repo names in CLAUDE.md: a guard satisfied without the thing it guards
  // being true. So it is aimed at a real change to a protected path, taken from this repo's own
  // history rather than a fixture that could drift away from what the rule means.
  test("it actually fires on a real change to a protected path", () => {
    const commit = execFileSync("git", ["log", "--format=%H", "-1", "--", "shared/schema.ts"], {
      encoding: "utf8",
    }).trim();
    assert.ok(commit, "no commit in this history touches shared/schema.ts");

    const hits = protectedHits(`${commit}~1`);
    assert.ok(
      hits.includes("shared/schema.ts"),
      `a diff that changes shared/schema.ts was not caught; got: ${hits.join(", ") || "nothing"}`
    );
    assert.ok(
      hits.some((h) => h.startsWith("server/") && h.includes("auth or the session table")),
      "the content rule for server/ never fired on a diff that changes auth"
    );
  });

  test("an unresolvable base is not read as a violation", () => {
    assert.deepEqual(protectedHits("refs/heads/no-such-branch-xyz"), []);
  });
});
