// tests/tooling/shellClaims.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKS = path.join(root, "docs/agents/checks.md");

/** The `## Shell` section's own numbers, parsed rather than trusted — a rewording that keeps the
 * same false claim, or a self-update that outgrows a hardcoded value, both have to show up here. */
function statedFloor(): { major: number | null; encoding: string | null } {
  const body = readFileSync(CHECKS, "utf8");
  const section = /## Shell\n([\s\S]*?)(?:\n## |$)/.exec(body)?.[1] ?? "";
  const major = /\$PSVersionTable\.PSVersion\.Major`?\s+is\s+\*{0,2}(\d+)\*{0,2}\s+or higher/i.exec(section)?.[1];
  const encoding = /\$OutputEncoding\.WebName`?\s+is\s+\*{0,2}([a-z0-9-]+)\*{0,2}/i.exec(section)?.[1];
  return { major: major ? Number(major) : null, encoding: encoding ?? null };
}

let pwshMissing = false;
try {
  execFileSync("pwsh", ["-NoProfile", "-Command", "exit"], { stdio: "ignore" });
} catch (err) {
  pwshMissing = (err as { code?: string })?.code === "ENOENT";
}

test(
  "the running shell meets the floor docs/agents/checks.md states",
  { skip: pwshMissing && "pwsh is not on PATH here; nothing to measure the doc's floor against" },
  () => {
    const floor = statedFloor();
    assert.ok(floor.major, "docs/agents/checks.md's Shell section must state a $PSVersionTable.PSVersion.Major floor");
    assert.ok(floor.encoding, "docs/agents/checks.md's Shell section must state an $OutputEncoding.WebName floor");

    const out = execFileSync(
      "pwsh",
      ["-NoProfile", "-Command", '"$($PSVersionTable.PSVersion.Major)|$($OutputEncoding.WebName)"'],
      { encoding: "utf8" },
    ).trim();
    const [majorText, encoding] = out.split("|");

    assert.ok(
      Number(majorText) >= floor.major!,
      `running pwsh is major ${majorText}; docs/agents/checks.md claims ${floor.major} or higher`,
    );
    assert.equal(
      encoding?.toLowerCase(),
      floor.encoding!.toLowerCase(),
      `running $OutputEncoding.WebName is ${encoding}; docs/agents/checks.md claims ${floor.encoding}`,
    );
  },
);
