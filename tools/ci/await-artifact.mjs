// Holds an ios.yml shard, its simulator already booted beside the app job, until that job has
// uploaded the app to this run; red as soon as the job ends without it.

import { execFileSync } from "node:child_process";
import { setTimeout as sleepMs } from "node:timers/promises";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const POLL_MS = 5000;

/**
 * @param {string} artifact
 * @param {string} producer the job that uploads it
 * @param {{ GITHUB_REPOSITORY?: string, GITHUB_RUN_ID?: string }} env
 * @param {(route: string) => string} ghApi
 * @param {() => Promise<unknown>} sleep
 * @returns {Promise<number>} the exit code
 */
export async function awaitArtifact(artifact, producer, env, ghApi, sleep, log = console.log, tries = 300) {
  const run = `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  for (let i = 0; i < tries; i++, await sleep()) {
    let job, artifacts;
    try {
      // Jobs before artifacts: a job read as finished has finished uploading, so an artifact missing
      // from the later read is missing for good.
      job = JSON.parse(ghApi(`${run}/jobs?filter=latest&per_page=100`)).jobs.find((j) => j.name === producer);
      if (job) ({ artifacts } = JSON.parse(ghApi(`${run}/artifacts?name=${artifact}`)));
    } catch (error) {
      log(`::warning::Reading the run failed, and is retried: ${error.message}`);
      continue;
    }
    if (!job) {
      log(`::error::The run has no job named "${producer}".`);
      return 1;
    }
    // An earlier attempt's upload stays listed under the run until this attempt's job replaces it.
    const fresh = (a) => Date.parse(a.created_at) >= Date.parse(job.started_at);
    if (artifacts.some((a) => a.name === artifact && !a.expired && job.started_at && fresh(a))) {
      log(`${artifact} is uploaded.`);
      return 0;
    }
    if (job.status === "completed") {
      log(`::error::"${producer}" ended ${job.conclusion} without uploading ${artifact}.`);
      return 1;
    }
  }
  log(`::error::${artifact} never appeared while "${producer}" ran.`);
  return 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [artifact, producer] = process.argv.slice(2);
  const ghApi = (route) => execFileSync("gh", ["api", route], { encoding: "utf8" });
  process.exitCode = await awaitArtifact(artifact, producer, process.env, ghApi, () => sleepMs(POLL_MS));
}
