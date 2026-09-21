// tools/loop/tests/queuePre.test.ts
import { test, describe } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {
  CHECKS,
  main,
  misnamedWorktrees,
  namedWorktrees,
  redMain,
  script,
  summarise,
} from "../queue-pre.mjs";
import { FOUND_NOTHING, IF_FOUND } from "../loop-derive.mjs";
import { listWorktreeDirNames } from "../prune-worktrees.mjs";

describe("misnamedWorktrees", () => {
  test("names a worktree that does not follow the convention", () => {
    const bad = misnamedWorktrees([".worktrees/agent-42", ".worktrees/fix-971", ".worktrees/agent-7"]);
    assert.deepEqual(bad, [".worktrees/fix-971"]);
  });

  test("reads the basename, whichever separator the path uses", () => {
    assert.deepEqual(misnamedWorktrees([".worktrees\\agent-42"]), []);
    assert.deepEqual(misnamedWorktrees(["C:/x/.worktrees/agent-983"]), []);
  });

  test("a trailing suffix is not an agent worktree", () => {
    assert.deepEqual(misnamedWorktrees([".worktrees/agent-42-old"]), [".worktrees/agent-42-old"]);
  });
});

describe("summarise", () => {
  test("takes the step's last word, which is the one it writes knowing how it went", () => {
    assert.equal(summarise("Primary: C:/x / LIVE\nRemoved 0 of 1; kept 1.\n"), "Removed 0 of 1; kept 1.");
  });

  test("drops the step's own name, which the row already carries", () => {
    assert.equal(summarise("reap: no orphan is burning CPU"), "no orphan is burning CPU");
  });

  test("keeps a colon that is part of the sentence", () => {
    assert.equal(summarise("preflight: C:/Users/roton/murlan is clean."), "C:/Users/roton/murlan is clean.");
    assert.equal(summarise("started at 10:32"), "started at 10:32");
  });

  test("silence summarises to nothing rather than to undefined", () => {
    for (const empty of ["", "   \n\n", null, undefined]) assert.equal(summarise(empty as never), "");
  });
});


describe("script", () => {
  const ran = (status: number | null, stdout: string, stderr = "") =>
    script(["x.mjs"], (() => ({ status, stdout, stderr })) as never)();

  test("a clean run is one row carrying the step's last word, and nothing else", () => {
    assert.deepEqual(ran(0, "noise\nreap: no orphan is burning CPU"), {
      state: "done",
      detail: "no orphan is burning CPU",
      note: "",
    });
  });

  test("a refusal stops the preamble with the script's own exit code", () => {
    const row = ran(3, "half a sentence", "the reason it refused");
    assert.equal(row?.state, "failed");
    assert.equal(row?.stop, 3, "the exit code is the script's, so the caller can tell them apart");
    assert.match(row?.note ?? "", /half a sentence/);
    assert.match(row?.note ?? "", /the reason it refused/, "a capture that eats the reason is worse than none");
  });

  test("a clean exit that wrote to stderr is a warning, and shows what it wrote", () => {
    const row = ran(0, "fine", "but note this");
    assert.equal(row?.state, "warned");
    assert.equal(row?.stop, undefined, "a warning must not refuse the ticket");
    assert.match(row?.note ?? "", /but note this/);
  });

  test("a refusal's note keeps the first 10 and last 30 lines of a long capture", () => {
    const out = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const note = ran(1, out)?.note ?? "";
    assert.match(note, /line 10\n… 60 lines omitted …\nline 71\n/);
    assert.doesNotMatch(note, /line 11\n/);
    assert.match(note, /line 100/);
  });

  /** A spawn that never started answers with a null status, which is not a success. */
  test("a step that could not be spawned refuses rather than passing", () => {
    const row = ran(null, "", "");
    assert.equal(row?.state, "failed");
    assert.equal(row?.stop, 1);
  });

  const asked = (status: number, stdout: string, stderr = "") =>
    script(["x.mjs", IF_FOUND], (() => ({ status, stdout, stderr })) as never)();

  test("a step that found nothing earns no row at all", () => {
    assert.equal(asked(FOUND_NOTHING, "reap: no orphan is burning CPU"), null);
  });

  test("a step that found nothing but raised a warning still earns one", () => {
    const row = asked(FOUND_NOTHING, "nothing to do", "but note this");
    assert.equal(row?.state, "warned");
    assert.equal(row?.stop, undefined);
  });

  test("that code is a refusal from a step this never asked the question of", () => {
    const row = ran(FOUND_NOTHING, "half a sentence", "");
    assert.equal(row?.state, "failed");
    assert.equal(row?.stop, FOUND_NOTHING);
  });
});

describe("CHECKS", () => {
  test("every spawned step is asked to answer only when it found something", () => {
    const spawned = CHECKS.filter((c) => c.run.args);
    assert.equal(spawned.length, 3);
    for (const { label, run } of spawned) {
      assert.ok(run.args?.includes(IF_FOUND), `${label} still prints on a no-op`);
    }
  });
});

describe("namedWorktrees", () => {
  test("says nothing when every worktree follows the convention", () => {
    assert.equal(namedWorktrees(["agent-42", "agent-7"]), null);
  });

  test("refuses, and says what to run", () => {
    const row = namedWorktrees(["agent-42", "fix-971"]);
    assert.equal(row?.state, "failed");
    assert.equal(row?.stop, 1);
    assert.match(row?.note ?? "", /worktrees:remove -- .*fix-971/);
  });

  test("reads directories only, so a scratch file beside a worktree does not stop the run", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "worktrees-"));
    try {
      mkdirSync(path.join(dir, "agent-1094"));
      writeFileSync(path.join(dir, "agent-1094.diff"), "diff --git a/x b/x\n");
      assert.deepEqual(listWorktreeDirNames(dir), ["agent-1094"]);
      assert.equal(namedWorktrees(listWorktreeDirNames(dir)), null);
      mkdirSync(path.join(dir, "cost-a5"));
      assert.equal(namedWorktrees(listWorktreeDirNames(dir))?.stop, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("redMain", () => {
  const gh = (conclusion: string | null, status = "completed") => (args: string[]) => {
    if (args[0] === "run" && args[1] === "list") {
      return JSON.stringify([{ databaseId: 7, conclusion, status, headSha: "abcdef1234", url: "https://x/1" }]);
    }
    if (args[1] === "view") {
      return JSON.stringify({ jobs: [{ name: "Typecheck and tests", conclusion: "failure", steps: [1, 2] }] });
    }
    if (args[1] === "list") return "[]";
    return "https://github.com/metasito/murlan/issues/5\n";
  };

  test("says nothing when main is green", () => {
    assert.equal(redMain(gh("success")), null);
  });

  test("names a red main, and does not refuse the ticket", () => {
    const row = redMain(gh("failure"));
    assert.equal(row?.state, "warned");
    assert.equal(row?.stop, undefined, "a red main is a warning plus a ticket, never a refusal");
    assert.match(row?.detail ?? "", /Typecheck and tests/);
    assert.match(row?.note ?? "", /issues\/5/, "the row points at the issue that outlives this process");
  });

  test("an unreachable tracker is silent rather than fatal", () => {
    assert.equal(
      redMain(() => {
        throw new Error("gh: not logged in");
      }),
      null,
    );
  });

  test("a run still going says nothing", () => {
    assert.equal(redMain(gh(null, "in_progress")), null);
  });
});

describe("main", () => {
  const check = (label: string, result: unknown = { state: "done", detail: "" }) =>
    ({ label, run: () => result }) as never;

  test("one row per check, in order, under the list's own label", () => {
    const said: { label: string }[] = [];
    const code = main((s) => said.push(s as never), [check("worktrees"), check("preflight"), check("reap")]);
    assert.equal(code, 0);
    assert.deepEqual(said.map((s) => s.label), ["worktrees", "preflight", "reap"]);
  });

  test("a check with nothing to say prints no row", () => {
    const said: unknown[] = [];
    assert.equal(main((s) => said.push(s as never), [check("worktrees", null), check("reap")]), 0);
    assert.equal(said.length, 1, "a quiet check must not leave an empty row behind");
  });

  test("a refusal stops the rest and carries its exit code out", () => {
    const said: { label: string }[] = [];
    const code = main((s) => said.push(s as never), [
      check("preflight", { state: "failed", stop: 3 }),
      check("reap"),
    ]);
    assert.equal(code, 3);
    assert.deepEqual(said.map((s) => s.label), ["preflight"], "nothing runs after a refusal");
  });

  test("every row is timed", () => {
    const said: { ms?: number }[] = [];
    main((s) => said.push(s as never), [check("reap")]);
    assert.equal(typeof said[0].ms, "number");
  });
});

/**
 * Read, never run: these spawn real scripts and prune real worktrees. A check dropped from the
 * list is a check that silently stops running, and the list is the only place that can be seen.
 */
describe("the shipped check list", () => {
  test("is every check this file defines, in the order the later ones depend on", () => {
    assert.deepEqual(
      CHECKS.map((c) => c.label),
      ["worktrees", "preflight", "reap", "worktrees", "main"],
    );
  });

  test("the naming check runs after the prune, not before it", () => {
    const pruned = CHECKS.findIndex((c) => c.run !== namedWorktrees && c.label === "worktrees");
    const named = CHECKS.findIndex((c) => c.run === namedWorktrees);
    assert.ok(pruned >= 0 && named > pruned, "otherwise it refuses over a worktree about to go");
  });

  test("a red main is the last word, so a refusal is never buried under it", () => {
    assert.equal(CHECKS.at(-1)?.run, redMain);
  });
});
