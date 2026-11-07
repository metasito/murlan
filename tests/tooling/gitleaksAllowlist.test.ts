import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { allSteps, loadWorkflow, stepIn } from "../helpers/workflow.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(repoRoot, ...p), "utf8");
const SCRIPT = path.join(repoRoot, ".github", "scripts", "gitleaks-scan.sh");

test("the scan honours no excuse the scanned tree can write for itself", () => {
  const script = read(".github", "scripts", "gitleaks-scan.sh").replace(/^#.*$/gm, "");
  assert.match(script, /--ignore-gitleaks-allow/, "an inline gitleaks:allow would hide the leak on its own line");
  assert.match(script, /--gitleaks-ignore-path=\/dev\/null/, "a committed .gitleaksignore would hide any fingerprint it lists");
  assert.doesNotMatch(script, /--baseline-path|\s-b\s|--exit-code|--no-git|--max-target-megabytes/);
});

test("the scan reads HEAD's history or the pull request's own commits, never every branch", () => {
  const script = read(".github", "scripts", "gitleaks-scan.sh").replace(/^#.*$/gm, "");
  assert.match(script, /detect [^\n]*--log-opts="\$scan_range"/, "without --log-opts gitleaks reads `git log --all`");

  const ci = loadWorkflow("ci.yml");
  const calls = allSteps(ci).filter((s) => s.run?.includes("gitleaks-scan.sh"));
  assert.equal(calls.length, 2, "the repository scan and its self-test");
  for (const s of calls) assert.match(s.run!, /gitleaks-scan\.sh "[^"]+" \S+ ("\$SCAN_RANGE"|HEAD)/, `${s.name} passes no range`);
  assert.equal(
    stepIn(ci, "gitleaks").step.env?.SCAN_RANGE,
    "${{ github.event_name == 'pull_request' && format('{0}..{1}', github.event.pull_request.base.sha, github.event.pull_request.head.sha) || 'HEAD' }}",
  );
});

test("the script refuses any range but HEAD or base..head before it runs a scan", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gitleaks-range-"));
  try {
    const ran = path.join(dir, "docker-ran");
    writeFileSync(path.join(dir, "docker"), `#!/bin/sh\necho "$@" > "${ran}"\n`);
    chmodSync(path.join(dir, "docker"), 0o755);
    const run = (range: string) => {
      rmSync(ran, { force: true });
      const r = spawnSync("bash", [SCRIPT, dir, path.join(dir, "out.txt"), range], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITLEAKS_IMAGE: "x" },
      });
      return { status: r.status, scanned: existsSync(ran) ? readFileSync(ran, "utf8") : null };
    };
    const sha = "a".repeat(40);
    for (const range of ["", "--all", "HEAD --all", "--branches", `${sha}..`, `..${sha}`]) {
      assert.deepEqual(run(range), { status: 2, scanned: null }, `range '${range}'`);
    }
    for (const range of ["HEAD", `${sha}..${"b".repeat(40)}`]) {
      const { status, scanned } = run(range);
      assert.equal(status, 0, `range '${range}'`);
      assert.match(scanned ?? "", new RegExp(`--log-opts=${range.replace(/\./g, "\\.")}\\n$`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
