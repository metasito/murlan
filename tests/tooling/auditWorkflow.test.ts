import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Runs .claude/workflows/audit.mjs with stub agents: what each verifier is
// shown, and what verdict each outcome of a reproduction becomes.

const SCRIPT = readFileSync(".claude/workflows/audit.mjs", "utf8").replace("export const meta", "const meta");
const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<any>;

const finding = (title: string, severity: string, path: string) => ({
  title, lens: "x", severity, confidence: "measured", platform: "server",
  locations: [{ path, line: 10 }], evidence: `NARRATIVE of ${title}`, failure_scenario: `${title} breaks`,
  defect_class: title, fix: `FIX for ${title}`, size: "S", tracked: null,
});
const PROVEN = finding("proven one", "low", "lib/a.ts");
const DISPROVEN = finding("disproven one", "medium", "server/b.ts");

async function run(args: Record<string, unknown>) {
  const prompts: { label: string; prompt: string }[] = [];
  const agent = async (prompt: string, opts: { label?: string } = {}) => {
    const label = opts.label ?? "";
    prompts.push({ label, prompt });
    if (label === "cartographer") return "map";
    if (label.startsWith("lens:")) {
      const empty = { strengths: [], score: 5, score_rationale: "", coverage: { read: [], not_reached: [], skills_used: [] } };
      return { ...empty, findings: label === "lens:game-logic" ? [PROVEN] : [], opportunities: [], platform: undefined };
    }
    if (label.startsWith("tools:")) return { findings: [DISPROVEN], dismissed: [{ alert: "knip files", reason: "a .web.ts twin" }] };
    if (label.startsWith("verify:")) return { refuted: false, reason: "seen", severity: "medium" };
    if (label.startsWith("prove:")) return { runnable: true, test_path: "proof.test.ts", reason: "" };
    if (label.startsWith("check:")) return { outcome: prompt.includes('"title":"proven one"') ? "fails-as-claimed" : "passes", reason: "ran it" };
    if (label.startsWith("critic:")) return { gaps: [] };
    if (label === "synthesis") return "report";
    return null;
  };
  const parallel = async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const body = new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", "budget", SCRIPT);
  const result = await body(args, agent, parallel, null, () => {}, () => {}, { total: null });
  return { result, prompts };
}

const ARGS = {
  repo: "C:/r", sha: "abc", openIssues: [], webUrl: null, scratch: "C:/s",
  lenses: ["game-logic", "network"],
  staticLayer: { alerts: [{ tool: "knip", rule: "files", path: "lib/x.web.ts", line: 1, message: "files" }], failed: [] },
};

test("a skeptic sees the claim, not the finder's argument, and refutes what it cannot confirm", async () => {
  const { prompts } = await run(ARGS);
  const skeptics = prompts.filter((p) => p.label.startsWith("verify:"));
  assert.equal(skeptics.length, 2, "a low finding gets a skeptic too");
  for (const { prompt } of skeptics) {
    assert.doesNotMatch(prompt, /NARRATIVE|FIX for/);
    assert.match(prompt, /set refuted=true/);
  }
  const checkers = prompts.filter((p) => p.label.startsWith("check:"));
  assert.equal(checkers.length, 2);
  for (const { prompt } of checkers) assert.doesNotMatch(prompt, /NARRATIVE|FIX for/);
});

test("a reproduction that fails as claimed proves a finding; one that passes refutes it", async () => {
  const { result } = await run(ARGS);
  assert.deepEqual(
    result.judged.map((f: { title: string; verdict: string }) => `${f.title}: ${f.verdict}`).sort(),
    ["disproven one: refuted", "proven one: proven"],
  );
  assert.equal(result.record.proven, 1);
  assert.equal(result.record.refuted, 1);
  assert.equal(result.record.alertsDismissed, 1);
  assert.deepEqual(result.record.lenses, ["network", "game-logic"]);
});

test("the audit refuses to start without its tool layer", async () => {
  await assert.rejects(run({ ...ARGS, staticLayer: undefined }), /staticLayer/);
});
