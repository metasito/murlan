import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(repoRoot, ...p), "utf8");

test("the scan honours no excuse the scanned tree can write for itself", () => {
  const script = read(".github", "scripts", "gitleaks-scan.sh").replace(/^#.*$/gm, "");
  assert.match(script, /--ignore-gitleaks-allow/, "an inline gitleaks:allow would hide the leak on its own line");
  assert.match(script, /--gitleaks-ignore-path=\/dev\/null/, "a committed .gitleaksignore would hide any fingerprint it lists");
  assert.doesNotMatch(script, /--baseline-path|\s-b\s|--exit-code|--no-git|--max-target-megabytes/);
});

test("the config's allowlist is #277's two scoped exemptions and nothing wider", () => {
  const config = read(".gitleaks.toml").replace(/^\s*#.*$/gm, "");
  assert.doesNotMatch(config, /^\[allowlist\]|^\[\[allowlists\]\]/m, "a global allowlist blinds every rule");
  const lists = config.split(/^\[rules\.allowlist\]$/m).slice(1);
  assert.equal(lists.length, 2);
  for (const list of lists) assert.match(list, /condition = "AND"/, "without AND, `paths` alone blinds the rule at that path");
  const regexes = [...config.matchAll(/regexes = \['''([^']+)'''\]/g)].map((m) => m[1]);
  // Split, or the full-history scan reads this line as a live AWS key.
  assert.deepEqual(regexes, ["sk_live_abc123xyz", "ASIA" + "2F3EMEYEYTWUKMG2"]);
});
