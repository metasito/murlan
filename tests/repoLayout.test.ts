import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function misplacedRules(files: string[]): string[] {
  return files.filter((f) => path.posix.basename(f) === "RULES.md" && !f.startsWith("docs/agents/"));
}

describe("the repository layout (#1131)", () => {
  const docs = trackedFiles(repoRoot, "docs");

  test("the only RULES.md under docs/ is the agents' one", () => {
    assert.ok(docs.includes("docs/agents/RULES.md"), "docs/agents/RULES.md is missing");
    assert.ok(docs.includes("docs/GAME-RULES.md"), "docs/GAME-RULES.md is missing");
    assert.deepEqual(misplacedRules(docs), []);
  });

  test("a RULES.md anywhere else under docs/ is caught", () => {
    assert.deepEqual(
      misplacedRules(["docs/agents/RULES.md", "docs/RULES.md", "docs/design/RULES.md"]),
      ["docs/RULES.md", "docs/design/RULES.md"],
    );
  });
});
