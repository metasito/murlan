// tests/guardBash.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../scripts/guard-bash.mjs";

describe("the bash guard blocks what has a correct alternative", () => {
  for (const cmd of [
    "git add -A",
    "git add .",
    "git add --all",
    "git commit -q -m x && git add -A",
    "cd /c/repo && git add -A -- .",
  ]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /pathspec/);
    });
  }

  for (const cmd of ["find / -iname node_modules", "find /c/ -name x", "find C:\\ -name x"]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /require\.resolve/);
    });
  }

  for (const cmd of [
    "git checkout -- components/MenuLayout.tsx",
    "git restore components/MenuLayout.tsx",
    "git restore -- a.ts",
    "npm test; git checkout -- a.ts b.ts",
    "git checkout --  spaced.ts",
    // --staged is safe on its own; adding --worktree is what discards the edits.
    "git restore --staged --worktree a.ts",
  ]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /Edit tool/);
    });
  }

  for (const cmd of [
    "git worktree remove .worktrees/w589 --force",
    "git worktree remove --force .worktrees/w589",
    "git worktree remove -f .worktrees/w589",
    "npm test; git worktree remove .worktrees/x --force",
    // Blanking a here-string body must not blind the guard to a real command beside it.
    "git commit -m @'\nmsg\n'@; git worktree remove .worktrees/x --force",
  ]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /worktrees:remove/);
    });
  }
});

// The floor. A guard that blocks everything passes every assertion above and makes the repo
// unusable, so the allowed cases are pinned as hard as the blocked ones.
describe("the bash guard allows correct usage", () => {
  for (const cmd of [
    "git add -- scripts/x.mjs tests/x.test.ts",
    "git add scripts/",
    "git add -p",
    "git status --short",
    "git commit -q -m 'x'",
    "find components -iname '*rail*'",
    "find . -maxdepth 2 -name package.json",
    "npm test",
    "gh pr create --title x",
    // The text as data, not as a command. A guard that fires on these blocks work that runs
    // nothing — it caught its own author writing a regex containing the phrase.
    // Naming a source is the deliberate, documented way back — and the only safe one, because
    // it is reached after the work being protected is committed.
    "git checkout HEAD -- components/MenuLayout.tsx",
    "git restore --source=HEAD~1 a.ts",
    "git restore --staged a.ts",
    // Moving between branches is not touching the working tree's contents.
    "git checkout -b agent/589-x origin/main",
    "git checkout main",
    "git checkout --track origin/x",
    // The plain remove refuses rather than deleting through a link, so it needs no guard.
    "git worktree remove .worktrees/w589",
    "git worktree list",
    "git worktree prune",
    // A here-string body is data — a commit message, a PR body — and its lines start at a line
    // start like any other. The guard blocked its own introducing commit over this.
    "git commit -m @'\nBlocked now:\n\n  git checkout -- <path>\n  git worktree remove --force\n'@",
    "gh pr create --body @\"\nRun `git restore x` and it reverts.\n\"@",
    "cat <<'EOF' > note.md\ngit checkout -- a.ts is what broke it\nEOF",
    "grep -n 'git add -A' docs/agents/RULES.md",
    "gh issue comment 5 --body 'never run git checkout -- on that file'",
    "node -e \"const p=/git add -A/; console.log(p)\"",
    "gh issue comment 5 --body 'do not use git add -A here'",
    "echo 'find / is slow' > note.txt",
    // The marker is the acknowledgement that the last failure's artefact was read. Reading it
    // is the point, so every command that does the reading has to stay open.
    "MAESTRO_EVIDENCE_READ=1 gh workflow run ios.yml --ref agent/353-x",
    "MAESTRO_EVIDENCE_READ=1 gh run rerun 33428375221 --failed",
    "gh run download 33428373840 -n maestro-debug-ios -D /tmp/art",
    "gh run view 33428373840 --json jobs",
    // Only the device workflows are gated: a browser or unit run has no pixels to read.
    "gh workflow run ci.yml --ref main",
  ]) {
    test(`allows: ${cmd}`, () => {
      assert.equal(check(cmd), null, `expected ${cmd} to be allowed`);
    });
  }
});

describe("a device run is gated on having read the last failure's artefact", () => {
  // A dispatch is ~25 minutes and the previous artefact usually already answers the question.
  // Run 33428373840 was spent rediscovering a screen the run before it had screenshotted.
  for (const cmd of [
    "gh workflow run ios.yml --ref agent/353-ios-offline-game",
    "gh workflow run maestro.yml",
  ]) {
    test(`blocks: ${cmd}`, () => {
      const message = check(cmd);
      assert.ok(message, `expected ${cmd} to be blocked`);
      assert.match(String(message), /MAESTRO_EVIDENCE_READ=1/);
      assert.match(String(message), /screen-hierarchy|screenshot/);
    });
  }
});

describe("a rerun is gated on the workflow it would re-dispatch, not on being a rerun", () => {
  // `gh run rerun <id>` names a run, not a workflow, so the command alone cannot say whether
  // it costs 25 minutes on a simulator or four on a browser shard. Asking is the only way to
  // know, and a guard that blocks the honest path teaches people to route around the marker.
  const asWorkflow = (name: string | null) => () => name;

  test("blocks a rerun of a device run", () => {
    const message = check("gh run rerun 33428375221 --failed", asWorkflow("iOS UI (Maestro)"));
    assert.ok(message, "expected a rerun of a Maestro run to be blocked");
    assert.match(String(message), /MAESTRO_EVIDENCE_READ=1/);
  });

  test("blocks a rerun of the Android device run", () => {
    assert.ok(check("gh run rerun 33428375221", asWorkflow("Android UI (Maestro)")));
  });

  test("allows a rerun of a run with no pixels to read", () => {
    assert.equal(check("gh run rerun 33495876524 --failed", asWorkflow("CI")), null);
  });

  test("allows a rerun the marker acknowledges", () => {
    assert.equal(
      check("MAESTRO_EVIDENCE_READ=1 gh run rerun 33428375221", asWorkflow("iOS UI (Maestro)")),
      null
    );
  });

  test("allows a rerun whose workflow cannot be resolved", () => {
    // Resolution goes through `gh`. If that cannot answer, the rerun it guards cannot dispatch
    // anything either, so blocking here costs the honest path and protects nothing.
    assert.equal(check("gh run rerun 33428375221 --failed", asWorkflow(null)), null);
  });

  // Resolution costs a network round trip, so it may only be spent on a command whose verdict
  // it can still change.
  for (const [what, cmd] of [
    ["a command that reruns nothing", "gh run view 33428373840 --json jobs"],
    ["a rerun the marker already allows", "MAESTRO_EVIDENCE_READ=1 gh run rerun 33428375221"],
  ]) {
    test(`does not ask about ${what}`, () => {
      let asked = 0;
      check(cmd, () => {
        asked += 1;
        return "iOS UI (Maestro)";
      });
      assert.equal(asked, 0, `${cmd} spent a round trip it could not have acted on`);
    });
  }
});

describe("a rerun is read as its own command, with its own arguments", () => {
  // Each of these reached the guard as a way past it. A rerun that cannot be read is refused
  // rather than allowed: `$RUN` must not be the spelling that gets through.
  const device = () => "iOS UI (Maestro)";
  const ci = () => "CI";

  test("reads --job, which is not a run id", () => {
    // `gh run view <job-id>` answers 404, so a job id resolved as a run resolves to nothing —
    // and `--job` re-dispatches the whole ~25 minute simulator job.
    let asked: unknown = null;
    const message = check("gh run rerun --job 99710945601", (t) => {
      asked = t;
      return "iOS UI (Maestro)";
    });
    assert.ok(message, "expected a device job rerun to be blocked");
    assert.deepEqual(asked, { job: "99710945601" });
  });

  test("reads --job= in its joined spelling", () => {
    assert.ok(check("gh run rerun --job=99710945601", device));
  });

  test("looks at every rerun on the line, not only the first", () => {
    for (const separator of [" && ", "; ", "\n"]) {
      const cmd = `gh run rerun 33495876524${separator}gh run rerun 33428375221`;
      const message = check(cmd, (t) => (t.run === "33428375221" ? "iOS UI (Maestro)" : "CI"));
      assert.ok(message, `expected the device rerun after a ${JSON.stringify(separator)} to block`);
    }
  });

  test("does not take a flag's value for the run id", () => {
    let asked: unknown = null;
    check("gh run rerun -R metasito/murlan 33428375221", (t) => {
      asked = t;
      return "CI";
    });
    assert.deepEqual(asked, { run: "33428375221" }, "the repo was read as the run");
  });

  test("does not take a later command's id for this one's", () => {
    // The download named here is the very command the block message prescribes as the way out.
    let asked: unknown = null;
    const message = check(
      'gh run rerun "$RUN" --failed\ngh run download 33428375221 -n maestro-debug-ios',
      (t) => {
        asked = t;
        return "iOS UI (Maestro)";
      }
    );
    assert.equal(asked, null, "the download's id was read as the rerun's");
    assert.match(String(message), /literal id/);
  });

  for (const cmd of ['gh run rerun "$RUN" --failed', "gh run rerun --failed"]) {
    test(`refuses a rerun it cannot identify: ${cmd}`, () => {
      const message = check(cmd, ci);
      assert.ok(message, `expected ${cmd} to be blocked`);
      assert.match(String(message), /literal id/);
    });
  }

  test("the marker still clears a rerun it cannot identify", () => {
    assert.equal(check('MAESTRO_EVIDENCE_READ=1 gh run rerun "$RUN" --failed', ci), null);
  });
});
