import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { Instrumenter } from "@stryker-mutator/instrumenter";
import { loadWorkflow, stepIn } from "../helpers/workflow.ts";
import { DATABASE_BACKED, SHARD_MUTANTS, SLOW_SHARD_MUTANTS, budgetOf, continuationOf, shards, summarize } from "../../tools/ci/mutation.mjs";
import { MUTATE } from "../../stryker.config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

type Mutant = { mutatorName: string; replacement: string; status: string; location: { start: { line: number } } };
const mutant = (status: string, line: number, replacement = "true", mutatorName = "ConditionalExpression"): Mutant => ({
  mutatorName,
  replacement,
  status,
  location: { start: { line } },
});
const movesFile = ["lib", "game", "moves.ts"].join("/");
const rulesFile = ["lib", "game", "rating.ts"].join("/");
const shard = (file: string, start: number, end: number, slug = `${file.replace(/\//g, "-")}-${start}`) => ({ file, start, end, mutate: `${file}:${start}-${end}`, slug });
const reportOf = (slug: string, file: string, mutants: Mutant[]) => ({ slug, report: { files: { [file]: { mutants } } } });

const silent = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, isDebugEnabled: () => false, isTraceEnabled: () => false };
const options = { plugins: null, excludedMutations: [], ignorers: [] };

/** How many mutants Stryker itself places in `file`, inside lines `start`–`end` when given, as `--mutate file:start-end` reads them. */
async function placed(file: string, range?: { start: number; end: number }): Promise<number> {
  const mutate = range ? [{ start: { line: range.start - 1, column: 0 }, end: { line: range.end - 1, column: Number.MAX_SAFE_INTEGER } }] : true;
  const content = readFileSync(path.join(repoRoot, file), "utf8");
  const { mutants } = await new Instrumenter(silent as never).instrument([{ name: file, mutate, content }], options as never);
  return mutants.length;
}

const all = await shards();

test("each file's shards cover its every line once, in order", () => {
  const files = [...new Set(all.map((s) => s.file))];
  assert.ok(files.length >= 20, `only ${files.length} files sharded`);
  assert.ok(files.includes(movesFile));
  assert.ok(files.some((f) => f.startsWith("server/game/")), "no server/game shard");
  for (const file of files) {
    const ranges = all.filter((s) => s.file === file);
    const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n").length;
    assert.equal(ranges[0].start, 1, file);
    for (const [i, r] of ranges.entries()) {
      assert.ok(r.start <= r.end, `${r.mutate} is empty`);
      assert.equal(r.mutate, `${file}:${r.start}-${r.end}`);
      if (i > 0) assert.equal(r.start, ranges[i - 1].end + 1, `a gap or an overlap before ${r.mutate}`);
    }
    assert.equal(ranges.at(-1)?.end, lines, `${file}'s last lines are in no shard`);
  }
  assert.equal(new Set(all.map((s) => s.slug)).size, all.length, "two shards share a slug, so a cache or an artifact");
  assert.ok(all.every((s) => /^[\w.-]+$/.test(s.slug)), "a slug is not a valid artifact or cache name");
});

test("a file whose tests need the database is cut into smaller shards than the rest", () => {
  assert.ok(SLOW_SHARD_MUTANTS < SHARD_MUTANTS);
  assert.equal(budgetOf("server/game/tableRouter.ts"), SLOW_SHARD_MUTANTS);
  assert.equal(budgetOf(movesFile), SHARD_MUTANTS);
  for (const file of DATABASE_BACKED) {
    const own = all.filter((s) => s.file === file);
    assert.ok(own.length > 0, `${file} is listed as database-backed but is not mutated`);
  }
  const router = all.filter((s) => s.file === "server/game/tableRouter.ts");
  assert.ok(router.length >= 2, "tableRouter.ts is one shard: the database-backed budget is not applied");
  assert.ok(Math.max(...router.map((s) => s.mutants)) <= SLOW_SHARD_MUTANTS * 2);
});

test("every mutant Stryker places lands in exactly one shard, and a shard outgrows the budget only where no cut can split it", async () => {
  const files = MUTATE.flatMap((pattern) => globSync(pattern, { cwd: repoRoot })).sort();
  let total = 0;
  for (const file of files) {
    const whole = await placed(file);
    total += whole;
    const ranges = all.filter((s) => s.file === file);
    if (whole === 0) {
      assert.deepEqual(ranges, [], `${file} has no mutant, so a shard of it would report nothing every week`);
      continue;
    }
    let inRanges = 0;
    for (const r of ranges) {
      const n = await placed(file, r);
      assert.equal(n, r.mutants, `${r.mutate} holds ${n} mutants, not the ${r.mutants} it was sized by`);
      assert.ok(n > 0, `${r.mutate} holds no mutant`);
      if (n > budgetOf(file)) {
        for (let cut = r.start; cut < r.end; cut++) {
          const [head, tail] = [await placed(file, { start: r.start, end: cut }), await placed(file, { start: cut + 1, end: r.end })];
          assert.ok(head === 0 || tail === 0 || head + tail < n,`${r.mutate} holds ${n} mutants, over the ${budgetOf(file)} a cold shard can test in its hour, yet cuts after line ${cut}`);
        }
      }
      inRanges += n;
    }
    assert.equal(inRanges, whole, `${file}: ${whole - inRanges} mutants straddle a cut and are in no shard`);
  }
  assert.ok(total >= 1000, `only ${total} mutants placed: the instrumenter no longer sees the code`);
});

test("every survivor is filed as file:line, mutator and replacement, with its file's score", () => {
  const { markdown, ok } = summarize(
    [reportOf("a", movesFile, [mutant("Killed", 4), mutant("Survived", 11), mutant("Timeout", 5), mutant("NoCoverage", 3, "+1", "UnaryOperator")])],
    [shard(movesFile, 1, 19, "a")],
  );
  assert.equal(ok, true);
  assert.match(markdown, /3 mutants tested, 2 undetected/);
  assert.match(markdown, new RegExp(`\\| \`${movesFile}\` \\| 50\\.0% \\| 1 \\| 1 \\| 1 \\| 1 \\|`));
  assert.match(markdown, new RegExp(`- \`${movesFile}:3\` UnaryOperator → \`\\+1\` \\(no test runs it\\)\\n- \`${movesFile}:11\` ConditionalExpression → \`true\`\\n`));
});

test("two shards of one file are scored as one file", () => {
  const { markdown, ok } = summarize(
    [reportOf("a", movesFile, [mutant("Killed", 4), mutant("Survived", 5)]), reportOf("b", movesFile, [mutant("Killed", 14), mutant("Survived", 15)])],
    [shard(movesFile, 1, 10, "a"), shard(movesFile, 11, 19, "b")],
  );
  assert.equal(ok, true);
  assert.match(markdown, new RegExp(`\\| \`${movesFile}\` \\| 50\\.0% \\| 2 \\| 0 \\| 2 \\| 0 \\|`));
  assert.match(markdown, new RegExp(`${movesFile}:5\`[^\\n]*\\n- \`${movesFile}:15\``));
});

test("a run that tested no mutant is an error, not a perfect score", () => {
  const { markdown, ok } = summarize([reportOf("a", movesFile, [mutant("NoCoverage", 3)])], [shard(movesFile, 1, 19, "a")]);
  assert.equal(ok, false);
  assert.match(markdown, /No mutant was tested/);
});

test("a shard that holds mutants but tested none is an error, though the rest of the run tested some", () => {
  const { markdown, ok } = summarize(
    [reportOf("a", movesFile, [mutant("Killed", 4)]), reportOf("b", rulesFile, [mutant("NoCoverage", 3), mutant("Pending", 9)])],
    [shard(movesFile, 1, 19, "a"), shard(rulesFile, 1, 40, "b")],
  );
  assert.equal(ok, false);
  assert.match(markdown, new RegExp(`\`${rulesFile}:1-40\`: 2 mutants, none tested`));
  assert.doesNotMatch(markdown, new RegExp(`\`${movesFile}:1-19\`: `));
});

test("a shard with no report fails the run and is named", () => {
  const { markdown, ok } = summarize([reportOf("a", movesFile, [mutant("Killed", 4)])], [shard(movesFile, 1, 10, "a"), shard(movesFile, 11, 19, "b")]);
  assert.equal(ok, false);
  assert.match(markdown, new RegExp(`\`${movesFile}:11-19\`: no report`));
});

test("a replacement holding backticks and newlines stays one code span", () => {
  const { markdown } = summarize([reportOf("a", movesFile, [mutant("Killed", 1), mutant("Survived", 2, "`a`\n  + b", "StringLiteral")])], [shard(movesFile, 1, 19, "a")]);
  assert.match(markdown, /StringLiteral → `` `a` \+ b ``$/m);
});

test("an oversize survivor list is split into comments, and no survivor is dropped", () => {
  const survivors = Array.from({ length: 2500 }, (_, i) => mutant("Survived", i + 1, `value${i + 1} ${"x".repeat(60)}`));
  const { parts, markdown, ok } = summarize([reportOf("a", movesFile, [mutant("Killed", 9999), ...survivors])], [shard(movesFile, 1, 9999, "a")]);
  assert.equal(ok, true);
  assert.ok(parts.length > 1, "the planted list must overflow one comment");
  assert.equal(markdown, parts[0]);
  for (const part of parts) assert.ok(part.length <= 60000, `a comment of ${part.length} characters`);
  const text = parts.join("\n");
  assert.doesNotMatch(text, /…and \d+ more/);
  for (let line = 1; line <= 2500; line++) assert.ok(text.includes(`\`${movesFile}:${line}\` `), `survivor at line ${line} was dropped`);
  assert.equal(text.match(/^- `lib\/game\/moves\.ts:/gm)?.length, 2500);
});

test("a report that fits is one comment, and continuation files are named in order", () => {
  const { parts } = summarize([reportOf("a", movesFile, [mutant("Killed", 4), mutant("Survived", 5)])], [shard(movesFile, 1, 19, "a")]);
  assert.equal(parts.length, 1);
  assert.equal(continuationOf("mutation-report.md", 2), "mutation-report.part-0002.md");
  assert.ok(continuationOf("r.md", 2) < continuationOf("r.md", 10));
});

test("mutation.yml runs weekly or on demand, never on a push or a pull request", () => {
  const on = loadWorkflow("mutation.yml").on as Record<string, unknown>;
  assert.deepEqual(Object.keys(on).sort(), ["schedule", "workflow_dispatch"]);
  const [cron] = (on.schedule as { cron: string }[]).map((c) => c.cron.split(" "));
  assert.notEqual(cron[0], "0", "on the hour, where GitHub's scheduler queues hardest");
  assert.match(cron[4], /^[0-6]$/, "not weekly");
});

test("a shard that runs out of time still keeps and uploads what it has", () => {
  const steps = loadWorkflow("mutation.yml").jobs.mutate.steps ?? [];
  assert.match(steps.find((s) => s.name === "Mutate")?.run ?? "", /npx stryker run --mutate "\$MUTATE" --incremental/);
  const save = steps.find((s) => s.uses?.startsWith("actions/cache/save@"));
  const upload = steps.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(save?.if, "always()");
  assert.equal(upload?.if, "always()");
});

test("mutation.yml files every run on the one issue, after every shard", () => {
  const workflow = loadWorkflow("mutation.yml");
  const { id, job, step } = stepIn(workflow, "Report the survivors to the tracker");
  assert.equal(job.if, "${{ !cancelled() }}", "a run with a red shard must still report");
  assert.deepEqual(job.needs, ["shards", "mutate"]);
  assert.equal(job.permissions?.issues, "write");
  assert.match(step.run ?? "", /bash tools\/ci\/report-to-tracker\.sh "Mutation testing: surviving mutants" mutation-report\.md mutation\n/);
  assert.match(step.run ?? "", /for part in mutation-report\.part-\*\.md; do[\s\S]*report-to-tracker\.sh "Mutation testing: surviving mutants" "\$part" mutation[\s\S]*done\n/, "the continuation comments must be filed too");
  assert.match(step.run ?? "", /exit "\$status"\s*$/, "a failed report must fail the run");
  assert.equal(job.steps?.at(-1), step);
  assert.equal(Object.keys(workflow.jobs).at(-1), id);
});
