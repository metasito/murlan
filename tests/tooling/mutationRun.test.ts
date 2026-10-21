import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorkflow, stepIn } from "../helpers/workflow.ts";
import { shards, summarize } from "../../tools/ci/mutation.mjs";

type Mutant = { mutatorName: string; replacement: string; status: string; location: { start: { line: number } } };
const mutant = (status: string, line: number, replacement = "true", mutatorName = "ConditionalExpression"): Mutant => ({
  mutatorName,
  replacement,
  status,
  location: { start: { line } },
});
const movesFile = ["lib", "game", "moves.ts"].join("/");
const rulesFile = ["lib", "game", "rating.ts"].join("/");

test("a shard per mutated file, across the engine and the server's game", () => {
  const files = shards().map((s) => s.file);
  assert.ok(files.length >= 20, `only ${files.length} shards`);
  assert.ok(files.includes(movesFile));
  assert.ok(files.some((f) => f.startsWith("server/game/")), "no server/game shard");
  assert.ok(shards().every((s) => /^[\w.-]+$/.test(s.slug)), "a slug is not a valid artifact or cache name");
});

test("every survivor is filed as file:line, mutator and replacement, with its file's score", () => {
  const { markdown, ok } = summarize(
    [{ files: { [movesFile]: { mutants: [mutant("Killed", 4), mutant("Survived", 11), mutant("Timeout", 5), mutant("NoCoverage", 3, "+1", "UnaryOperator")] } } }],
    [movesFile],
  );
  assert.equal(ok, true);
  assert.match(markdown, /3 mutants tested, 2 undetected/);
  assert.match(markdown, new RegExp(`\\| \`${movesFile}\` \\| 50\\.0% \\| 1 \\| 1 \\| 1 \\| 1 \\|`));
  assert.match(markdown, new RegExp(`- \`${movesFile}:3\` UnaryOperator → \`\\+1\` \\(no test runs it\\)\\n- \`${movesFile}:11\` ConditionalExpression → \`true\`\\n`));
});

test("a run that tested no mutant is an error, not a perfect score", () => {
  const { markdown, ok } = summarize([{ files: { [movesFile]: { mutants: [mutant("NoCoverage", 3)] } } }], [movesFile]);
  assert.equal(ok, false);
  assert.match(markdown, /No mutant was tested/);
});

test("a shard with no report fails the run and is named", () => {
  const { markdown, ok } = summarize([{ files: { [movesFile]: { mutants: [mutant("Killed", 4)] } } }], [movesFile, rulesFile]);
  assert.equal(ok, false);
  assert.match(markdown, new RegExp(`\`${rulesFile}\`: no report`));
});

test("a replacement holding backticks and newlines stays one code span", () => {
  const { markdown } = summarize([{ files: { [movesFile]: { mutants: [mutant("Killed", 1), mutant("Survived", 2, "`a`\n  + b", "StringLiteral")] } } }], [movesFile]);
  assert.match(markdown, /StringLiteral → `` `a` \+ b ``$/m);
});

test("mutation.yml runs weekly or on demand, never on a push or a pull request", () => {
  const on = loadWorkflow("mutation.yml").on as Record<string, unknown>;
  assert.deepEqual(Object.keys(on).sort(), ["schedule", "workflow_dispatch"]);
  const [cron] = (on.schedule as { cron: string }[]).map((c) => c.cron.split(" "));
  assert.notEqual(cron[0], "0", "on the hour, where GitHub's scheduler queues hardest");
  assert.match(cron[4], /^[0-6]$/, "not weekly");
});

test("mutation.yml files every run on the one issue, after every shard", () => {
  const workflow = loadWorkflow("mutation.yml");
  const { id, job, step } = stepIn(workflow, "Report the survivors to the tracker");
  assert.equal(job.if, "${{ !cancelled() }}", "a run with a red shard must still report");
  assert.equal(job.needs, "mutate");
  assert.equal(job.permissions?.issues, "write");
  assert.match(step.run ?? "", /bash tools\/ci\/report-to-tracker\.sh "Mutation testing: surviving mutants" mutation-report\.md mutation\n/);
  assert.match(step.run ?? "", /exit "\$status"\s*$/, "a failed report must fail the run");
  assert.equal(job.steps?.at(-1), step);
  assert.equal(Object.keys(workflow.jobs).at(-1), id);
  const mutate = workflow.jobs.mutate.steps?.find((s) => s.name === "Mutate");
  assert.match(mutate?.run ?? "", /npx stryker run --mutate "\$FILE" --incremental/);
});
