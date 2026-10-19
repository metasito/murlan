import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO } from "../cli.mjs";

// Only whether gh holds any credential, read without the network: whether it works is the test's to find.
function ghHasCredentials(): boolean {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true;
  const configDir =
    process.env.GH_CONFIG_DIR ||
    (process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, "gh")) ||
    (process.platform === "win32" && process.env.APPDATA ? path.join(process.env.APPDATA, "GitHub CLI") : path.join(os.homedir(), ".config", "gh"));
  return existsSync(path.join(configDir, "hosts.yml"));
}

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", timeout: 30_000 }).trim();

// REST omits the field for a caller who cannot push, as ci.yml's token cannot; GraphQL is refused from
// Claude sessions. Each answers where the other does not.
function deleteBranchOnMerge(): string {
  const rest = gh(["api", `repos/${REPO}`, "--jq", ".delete_branch_on_merge"]);
  if (rest !== "null" && rest !== "") return rest;
  const [owner, name] = REPO.split("/");
  return String(JSON.parse(gh(["api", "graphql", "-f", `query={repository(owner:"${owner}",name:"${name}"){deleteBranchOnMerge}}`])).data.repository.deleteBranchOnMerge);
}

// `runSettle` deletes no merged branch: GitHub does, and only while this setting is on. A branch left on
// origin with no open pull request strands its ticket (#294).
// ci.yml's harness job runs this file alone and fails if it skipped, so a missing token cannot pass there.
test("the repository deletes a branch when its pull request merges", { skip: !ghHasCredentials() && "no gh credentials" }, () => {
  assert.equal(deleteBranchOnMerge(), "true", "Settings › General › Automatically delete head branches is off");
});
