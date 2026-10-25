import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Runs .claude/workflows/audit.mjs with stub agents: what each verifier is
// shown, and what verdict each outcome of a reproduction becomes.

const SCRIPT = readFileSync(".claude/workflows/audit.mjs", "utf8").replace("export const meta", "const meta");
const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<any>;

const finding = (title: string, severity: string, path: string) => ({
  title, lens: "x", severity, confidence: "measured", platform: "server",
  locations: [{ path, line: 10 }], evidence: `NARRATIVE of ${title}`, failure_scenario: `${title} breaks`,
  defect_class: title, fix: `FIX for ${title}`, size: "S", tracked: null,
});
const PROVEN = finding("proven one", "medium", "src/a.ts");
const LOW = finding("low one", "low", "src/c.ts");
const ASIDE = finding("aside one", "info", "src/d.ts");
const SPLIT = finding("split one", "high", "src/e.ts");
const DISPROVEN = finding("disproven one", "medium", "api/b.ts");

async function run(args: Record<string, unknown>, merge: unknown = null) {
  const prompts: { label: string; prompt: string }[] = [];
  const agent = async (prompt: string, opts: { label?: string } = {}) => {
    const label = opts.label ?? "";
    prompts.push({ label, prompt });
    if (label === "cartographer") return "map";
    if (label === "merge") return merge;
    if (label.startsWith("lens:")) {
      const empty = { strengths: [], score: 5, score_rationale: "", coverage: { read: [], not_reached: [], skills_used: [] } };
      return { ...empty, findings: label === "lens:game-logic" ? [PROVEN, LOW, ASIDE] : label === "lens:network" ? [SPLIT] : [], opportunities: [], platform: undefined };
    }
    if (label.startsWith("tools:")) return { findings: [DISPROVEN], dismissed: [{ alert: "knip files", reason: "a .web.ts twin" }] };
    if (label.startsWith("verify:")) return { refuted: label === "verify:intent:split one", reason: "seen", severity: "high" };
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
  staticLayer: { alerts: [{ tool: "knip", rule: "files", path: "src/x.web.ts", line: 1, message: "files" }], failed: [] },
};

test("a skeptic sees the claim, not the finder's argument, and refutes what it cannot confirm", async () => {
  const { prompts } = await run(ARGS);
  const skeptics = prompts.filter((p) => p.label.startsWith("verify:"));
  assert.deepEqual(
    skeptics.map((p) => p.label.split(":")[2]).sort(),
    ["disproven one", "low one", "proven one", "split one", "split one"],
    "one skeptic each below high, two for high, none for info",
  );
  for (const { prompt } of skeptics) {
    assert.doesNotMatch(prompt, /NARRATIVE|FIX for/);
    assert.match(prompt, /set refuted=true/);
  }
  const checkers = prompts.filter((p) => p.label.startsWith("check:"));
  assert.equal(checkers.length, 3, "only medium and up are reproduced");
  assert.ok(prompts.some((p) => p.label === "prove:split one"), "a split vote goes on to the reproduction");
  for (const { prompt } of checkers) assert.doesNotMatch(prompt, /NARRATIVE|FIX for/);
});

test("a reproduction that fails as claimed proves a finding; one that passes refutes it", async () => {
  const { result } = await run(ARGS);
  assert.deepEqual(
    result.judged.map((f: { title: string; verdict: string }) => `${f.title}: ${f.verdict}`).sort(),
    ["aside one: unverified", "disproven one: refuted", "low one: upheld", "proven one: proven", "split one: refuted"],
  );
  assert.equal(result.record.proven, 1);
  assert.equal(result.record.refuted, 2);
  assert.equal(result.record.alertsDismissed, 1);
  assert.deepEqual(result.record.lenses, ["network", "game-logic"]);
});

test("the audit refuses to start without its tool layer", async () => {
  await assert.rejects(run({ ...ARGS, staticLayer: undefined }), /staticLayer/);
});

test("the merge folds the duplicates it names and drops nothing", async () => {
  const { result, prompts } = await run(ARGS, { groups: [[1, 2]] });
  assert.doesNotMatch(prompts.find((p) => p.label === "merge")!.prompt, /NARRATIVE|FIX for/);
  assert.equal(result.record.raw, 5);
  assert.equal(result.record.merged, 4);
  const folded = result.judged.find((f: { title: string }) => f.title === "proven one");
  assert.deepEqual(folded.locations.map((l: { path: string }) => l.path), ["src/a.ts", "src/c.ts"]);
});

test("the audit's dependency lens does not deny the patches/ folder that exists", () => {
  assert.ok(existsSync("patches"));
  assert.ok(!/no patches\/ directory/.test(SCRIPT));
});
