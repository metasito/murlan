// tests/loopGate.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

import { PROTECTED, verdictAllows, protectedHits } from "../scripts/loop-gate.mjs";
import { statePath, stateDir } from "../scripts/loop-state.mjs";

/**
 * Phase E branches on this command's exit code, so that is what is asserted — never a function's
 * return value. A `main()` that printed every refusal and returned 0 would keep a suite of unit
 * tests green while letting every skipped phase through.
 *
 * The live state is outside the working tree, so these write it directly and restore whatever was
 * there. Nothing here goes through a pipe: a pipeline reports the last command's status.
 */
const LIVE = statePath();
const BACKUP = `${LIVE}.testbak`;

const state = (over: Record<string, string> = {}) => {
  const f: Record<string, string> = {
    status: "RUNNING",
    ticket: "824",
    branch: "agent/824-x",
    recon: "lib/a.ts",
    verdict: "VERDICT: LAND",
    ...over,
  };
  const dod = f.dod === "" ? "dod:\n" : "dod:\n  - [x] done\n";
  delete f.dod;
  return Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n" + dod;
};

function gate(text: string, extra: string[] = []): number {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(LIVE, text, "utf8");
  const r = spawnSync(process.execPath, ["scripts/loop-gate.mjs", ...extra], { encoding: "utf8" });
  return r.status ?? -1;
}

before(() => {
  mkdirSync(stateDir(), { recursive: true });
  if (existsSync(LIVE)) copyFileSync(LIVE, BACKUP);
});
after(() => {
  if (existsSync(BACKUP)) {
    copyFileSync(BACKUP, LIVE);
    rmSync(BACKUP, { force: true });
  } else rmSync(LIVE, { force: true });
});

describe("the gate's exit code, which is what phase E reads", () => {
  test("a complete run over real commits is allowed", () => {
    assert.equal(gate(state()), 0);
  });

  for (const [name, over] of [
    ["phase B never ran", { recon: "" }],
    ["phase D never ran", { verdict: "" }],
    ["phase A wrote no Definition of done", { dod: "" }],
    ["phase A never claimed a ticket", { ticket: "" }],
  ] as [string, Record<string, string>][]) {
    test(`refuses when ${name}`, () => assert.equal(gate(state(over)), 1));
  }

  test("no live run, and no state at all, are exit 2 and never 0", () => {
    assert.equal(gate(state({ status: "IDLE" })), 2);
    rmSync(LIVE, { force: true });
    const r = spawnSync(process.execPath, ["scripts/loop-gate.mjs"], { encoding: "utf8" });
    assert.equal(r.status, 2);
  });
});

// The defect: the template hinted `HOLD - reason`, the gate matched only `/^VERDICT:\s*HOLD/`, so
// following the template printed "has evidence for every phase - HOLD ..." and exited 0.
describe("only an explicit LAND is permission", () => {
  for (const bad of [
    "HOLD - the guard exempts its own case",
    "VERDICT: HOLD - it is wrong",
    "hold",
    "LAND",
    "VERDICT: LAND, with reservations",
    "the reviewer was happy",
  ]) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      assert.equal(verdictAllows(bad), false);
      assert.equal(gate(state({ verdict: bad })), 1);
    });
  }

  for (const good of ["VERDICT: LAND", "verdict: land", "VERDICT:LAND", "  VERDICT: LAND  "]) {
    test(`allows ${JSON.stringify(good)}`, () => assert.equal(verdictAllows(good), true));
  }
});

// Every path, not one of them. The previous fixtures aimed only at shared/schema.ts, so the list
// could lose .github/workflows/ and .replit with the whole suite still green.
describe("every protected path is actually guarded", () => {
  let root: string;
  before(() => {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  });

  for (const p of PROTECTED) {
    test(`${p} is caught`, () => {
      const file = p.endsWith("/") ? `${p}probe.yml` : p;
      const wt = join(process.env.TEMP ?? "/tmp", `pp-${Math.random().toString(36).slice(2)}`);
      execFileSync("git", ["worktree", "add", "-q", "--detach", wt, "origin/main"], { cwd: root });
      try {
        const target = join(wt, file);
        mkdirSync(join(target, ".."), { recursive: true });
        const before_ = existsSync(target) ? readFileSync(target, "utf8") : "";
        writeFileSync(target, `${before_}
# probe
`);
        execFileSync("git", ["add", "--", file], { cwd: wt });
        execFileSync(
          "git",
          ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "probe"],
          { cwd: wt }
        );
        const hits = protectedHits("origin/main", wt);
        assert.ok(
          hits.some((h) => h.startsWith(p) || h.startsWith(file)),
          `${p} was changed and the gate did not catch it; got: ${hits.join(", ") || "nothing"}`
        );
      } finally {
        execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
      }
    });
  }
});

describe("git is the evidence, not the state file", () => {
  test("a state claiming a finished run over an empty diff is refused", () => {
    assert.equal(gate(state(), ["--base", "HEAD"]), 1);
  });

  test("and the same state over real commits is allowed", () => {
    assert.equal(gate(state()), 0);
  });

  test("protectedHits is empty on a branch that touches none of them", () => {
    assert.deepEqual(protectedHits("HEAD"), []);
  });
});
