// What one CI run spent outside its browser specs, priced from the run's own job timings, so the
// shard model in `e2e-shard.mjs` reads a measurement instead of numbers typed from an old run.
// The `Browser test report` job writes it on every green run; the weekly one commits it.
//
// By hand, for a finished run:
//
//   gh api repos/metasito/murlan/actions/runs/<id>/jobs?per_page=100 > jobs.json
//   gh run view <id> --log --job <scope job id> | grep -o 'timings=.*' | cut -c9- > split.json
//   gh run download <id> -n e2e-timings              # the measured timings.json
//   node tools/ci/ci-run-costs.mjs jobs.json split.json timings.json tests/e2e/run-costs.json

import { readFileSync, writeFileSync } from "node:fs";

import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { assignShards, specFilesIn } from "./e2e-shard.mjs";

const SCOPE = "Does this change need the suite?";
const REPORT = "Browser test report";
const SHARD = /^Browser tests (\d+)\/(\d+)$/;

/** @param {string} iso */
const seconds = (iso) => Date.parse(iso) / 1000;
/** @param {number} n */
const up2 = (n) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;

/**
 * @param {{ run: number, jobs: any[], split: Record<string, number>, measured: Record<string, number>,
 *   files: string[], now?: string }} input `split` is what the run's shards were planned by, `measured`
 *   what its specs then took; `now` ends a report job that is still running, as it is when it calls this
 */
export function runCosts({ run, jobs, split, measured, files, now = new Date().toISOString() }) {
  const byName = (/** @type {string} */ name) => {
    const found = jobs.find((j) => j.name === name);
    if (!found) throw new Error(`run ${run} has no "${name}" job`);
    return found;
  };
  const attempts = [...new Set(jobs.map((j) => j.run_attempt ?? 1))].sort();
  if (attempts.length > 1) throw new Error(`run ${run} spans attempts ${attempts.join(", ")}; a re-run's clock is not one run's`);
  const shardJobs = jobs.filter((j) => SHARD.test(j.name));
  const total = Number(SHARD.exec(shardJobs[0]?.name ?? "")?.[2] ?? 0);
  if (total === 0 || shardJobs.length !== total) {
    throw new Error(`run ${run} has ${shardJobs.length} of ${total} shards; a run missing one measures nothing`);
  }
  for (const j of shardJobs) {
    if (j.conclusion !== "success") throw new Error(`${j.name} ended ${j.conclusion}; a red shard is not a measurement`);
  }

  const start = Math.min(...jobs.filter((j) => j.conclusion !== "skipped").map((j) => seconds(j.started_at)));
  const scopeEnd = seconds(byName(SCOPE).completed_at);
  const report = byName(REPORT);
  const reportEnd = seconds(report.completed_at ?? now);

  const plan = assignShards(files, split, total);
  const shards = shardJobs
    .map((j) => {
      const shard = Number(SHARD.exec(j.name)?.[1]);
      const { files: ran, seconds: plannedSeconds } = plan[shard - 1];
      const specSeconds = Math.round(ran.reduce((sum, f) => sum + (measured[f] ?? split[f] ?? 0), 0));
      return { shard, plannedSeconds, specSeconds, wallSeconds: Math.round(seconds(j.completed_at) - scopeEnd) };
    })
    .sort((a, b) => a.shard - b.shard);

  const overheads = shards.map((s) => s.wallSeconds - s.specSeconds).sort((a, b) => a - b);
  const mid = overheads.length >> 1;
  const shardOverheadSeconds = Math.ceil(overheads.length % 2 ? overheads[mid] : (overheads[mid - 1] + overheads[mid]) / 2);
  const lastShardEnd = scopeEnd + Math.max(...shards.map((s) => s.wallSeconds));
  // Against the mean of what the specs took, not of what the split priced them at: `shardsNeeded`
  // divides the committed timings, which are measurements, so a noise taken against a stale split's
  // heavier prices would shrink by exactly the staleness.
  const meanSpecSeconds = shards.reduce((sum, s) => sum + s.specSeconds, 0) / total;
  const lastShard = shardJobs.reduce((a, b) => (seconds(b.completed_at) > seconds(a.completed_at) ? b : a));
  const stepsOf = (/** @type {any} */ j) => ({
    job: j.name,
    steps: Object.fromEntries(
      (j.steps ?? []).filter((s) => s.started_at).map((s) => [s.name, Math.round(seconds(s.completed_at ?? now) - seconds(s.started_at))])
    ),
  });

  return {
    run,
    aroundShardsSeconds: Math.round(scopeEnd - start + reportEnd - lastShardEnd),
    shardOverheadSeconds,
    shardNoise: up2((lastShardEnd - scopeEnd - shardOverheadSeconds) / meanSpecSeconds),
    shards,
    criticalPath: [byName(SCOPE), lastShard, report].map(stepsOf),
    otherJobsEndSeconds: Object.fromEntries(
      jobs
        .filter((j) => j.conclusion !== "skipped" && j.name !== SCOPE && j.name !== REPORT && !SHARD.test(j.name))
        .map((j) => [j.name, j.completed_at ? Math.round(seconds(j.completed_at) - start) : null])
        .sort(([a], [b]) => a.localeCompare(b))
    ),
  };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [jobsFile, splitFile, measuredFile, out] = process.argv.slice(2);
  if (!out) throw new Error("usage: node tools/ci/ci-run-costs.mjs <jobs.json> <split.json> <measured.json> <out.json>");
  const read = (/** @type {string} */ f) => JSON.parse(readFileSync(f, "utf8"));
  const payload = read(jobsFile);
  const jobs = Array.isArray(payload) ? payload : payload.jobs;
  const costs = runCosts({ run: jobs[0].run_id, jobs, split: read(splitFile), measured: read(measuredFile), files: specFilesIn() });
  writeFileSync(out, `${JSON.stringify(costs, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...costs, shards: undefined })}\n`);
}
