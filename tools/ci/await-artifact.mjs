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
  for (let i = 0; i < tries; i++) {
    // Jobs before artifacts: a job read as finished has finished uploading, so an artifact missing
    // from the later read is missing for good.
    const job = JSON.parse(ghApi(`${run}/jobs?filter=latest&per_page=100`)).jobs.find((j) => j.name === producer);
    if (!job) {
      log(`::error::The run has no job named "${producer}".`);
      return 1;
    }
    const { artifacts } = JSON.parse(ghApi(`${run}/artifacts?name=${artifact}`));
    if (artifacts.some((a) => a.name === artifact && !a.expired)) {
      log(`${artifact} is uploaded.`);
      return 0;
    }
    if (job.status === "completed") {
      log(`::error::"${producer}" ended ${job.conclusion} without uploading ${artifact}.`);
      return 1;
    }
    await sleep();
  }
  log(`::error::${artifact} never appeared while "${producer}" ran.`);
  return 1;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [artifact, producer] = process.argv.slice(2);
  const ghApi = (route) => execFileSync("gh", ["api", route], { encoding: "utf8" });
  process.exitCode = await awaitArtifact(artifact, producer, process.env, ghApi, () => sleepMs(POLL_MS));
}
