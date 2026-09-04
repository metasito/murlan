// tests/loopGateCli.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase E branches on this command's *exit code*, not on its exports. Those are different things:
 * the unit tests call `check()` directly and would stay green through a main() that printed every
 * refusal and returned 0 regardless — which is the shape of bug that reaches main, because a
 * refusal that prints looks exactly like a refusal that works.
 *
 * So this drives the real CLI and reads the real status. Nothing here goes through a pipe: a
 * pipeline reports the *last* command's status, and reading CI that way is how a red branch once
 * landed.
 */
const STATE = `status: RUNNING
ticket: 824
branch: agent/824-x
dod:
  - [x] done
recon: lib/a.ts
verdict: VERDICT: LAND
`;

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "loop-gate-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function gate(state: string | null, extra: string[] = []): number {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.md`);
  if (state !== null) writeFileSync(path, state, "utf8");
  const r = spawnSync(process.execPath, ["scripts/loop-gate.mjs", "--state", path, ...extra], {
    encoding: "utf8",
  });
  return r.status ?? -1;
}

describe("the gate's exit code, which is what phase E actually reads", () => {
  test("every phase has evidence and the reviewer said LAND: allows the push", () => {
    assert.equal(gate(STATE), 0);
  });

  for (const [name, state] of [
    ["phase B never ran", STATE.replace("recon: lib/a.ts", "recon:")],
    ["phase D never ran", STATE.replace("verdict: VERDICT: LAND", "verdict:")],
    ["phase A wrote no Definition of done", STATE.replace(/dod:\n  - \[x\] done\n/, "dod:\n")],
    ["the reviewer held the diff", STATE.replace("VERDICT: LAND", "VERDICT: HOLD — it is wrong")],
    ["the template's hint is mistaken for evidence", STATE.replace("recon: lib/a.ts", "recon:  # B")],
  ] as [string, string][]) {
    test(`refuses the push when ${name}`, () => {
      assert.equal(gate(state), 1, `${name} did not produce a refusing exit code`);
    });
  }

  test("refuses when the diff changes a protected path", () => {
    const commit = execFileSync("git", ["log", "--format=%H", "-1", "--", "shared/schema.ts"], {
      encoding: "utf8",
    }).trim();
    assert.ok(commit, "no commit in this history touches shared/schema.ts");
    assert.equal(gate(STATE, ["--base", `${commit}~1`]), 1);
  });

  // Exit 2 is "I could not judge", and phase E must not read it as permission.
  test("no live run, or no state file at all, is exit 2 and never 0", () => {
    assert.equal(gate(STATE.replace("status: RUNNING", "status: IDLE")), 2);
    assert.equal(gate(null), 2);
  });
});
