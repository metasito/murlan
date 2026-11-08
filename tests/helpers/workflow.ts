import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { trackedFiles } from "./trackedFiles.ts";

export interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
  "continue-on-error"?: unknown;
}
export interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  "runs-on"?: unknown;
  "timeout-minutes"?: number;
  "continue-on-error"?: unknown;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  strategy?: { "fail-fast"?: boolean; matrix?: Record<string, unknown> };
  steps?: Step[];
}
export interface Workflow {
  name?: string;
  on: unknown;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS = path.join(".github", "workflows");

/** Parses .github/workflows/<file> with `yaml`; throws naming the file on a parse error. */
export function loadWorkflow(file: string): Workflow {
  const text = readFileSync(path.join(repoRoot, WORKFLOWS, file), "utf8");
  try {
    return parse(text) as Workflow;
  } catch (err) {
    throw new Error(`${WORKFLOWS}/${file} does not parse: ${(err as Error).message}`);
  }
}

/** A composite action under .github/actions/<name>, its steps held as a job's so `step` reads them. */
export function loadAction(name: string): Job & { inputs?: Record<string, unknown> } {
  const file = path.join(".github", "actions", name, "action.yml");
  const action = parse(readFileSync(path.join(repoRoot, file), "utf8")) as { name?: string; inputs?: Record<string, unknown>; runs?: { steps?: Step[] } };
  if (!action?.runs?.steps) throw new Error(`${file} is not a composite action`);
  return { name: action.name, inputs: action.inputs, steps: action.runs.steps };
}

/** Every step of every job in a workflow. */
export const allSteps = (workflow: Workflow): Step[] => Object.values(workflow.jobs).flatMap((j) => j.steps ?? []);

/** The tracked workflow files, by basename. */
export function workflowFiles(): string[] {
  return trackedFiles(repoRoot, WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => path.basename(f));
}

/** The step whose `name` or `id` equals `key`; throws (never undefined) so a rename is a named red. */
export function step(job: Job, key: string): Step {
  const found = (job.steps ?? []).find((s) => s.name === key || s.id === key);
  if (!found) throw new Error(`no step named or id'd "${key}" in job ${job.name ?? "(unnamed)"}`);
  return found;
}

/** The one job of `workflow` holding the step `key`, and the step; throws when none or several do. */
export function stepIn(workflow: Workflow, key: string): { id: string; job: Job; step: Step } {
  const holders = Object.entries(workflow.jobs).filter(([, j]) => (j.steps ?? []).some((s) => s.name === key || s.id === key));
  if (holders.length !== 1) throw new Error(`${holders.length} jobs hold a step named or id'd "${key}"`);
  const [id, job] = holders[0];
  return { id, job, step: step(job, key) };
}

/** Index order of steps, for "A runs before B" claims. */
export function stepIndex(job: Job, key: string): number {
  return (job.steps ?? []).indexOf(step(job, key));
}

/** A job's `needs`, always as a list. */
export const needsOf = (job: Job): string[] => [job.needs ?? []].flat();
