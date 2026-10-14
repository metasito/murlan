import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { REPO } from "../loop-derive.mjs";

// The landing deletes no merged branch: GitHub does, and only while this setting is on. A branch left on
// origin with no open pull request strands its ticket (#294). GraphQL, not `gh api repos/…`: REST omits
// the field for a caller who cannot push, and ci.yml's token cannot.
test("the repository deletes a branch when its pull request merges", () => {
  const [owner, name] = REPO.split("/");
  const out = execFileSync(
    "gh",
    ["api", "graphql", "-f", `query={repository(owner:"${owner}",name:"${name}"){deleteBranchOnMerge}}`],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(JSON.parse(out).data.repository.deleteBranchOnMerge, true, "Settings › General › Automatically delete head branches is off");
});
