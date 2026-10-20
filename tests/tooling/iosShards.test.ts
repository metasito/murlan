import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CAPTURE_VIEWER_SEAT, captureGameState, capturePile, captureStateById } from "../../lib/captureStates.ts";
import { seatDirection } from "../../components/seatLayout.ts";
import { loadWorkflow, needsOf, step, stepIndex, type Job, type Step } from "../helpers/workflow.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const code = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/[ \t]*#.*$/gm, "");
const IOS = loadWorkflow("ios.yml");
const FELT = ".maestro/felt-opaque.yaml";
const CAPTURES = ".maestro/captures.yaml";
const WARMUP = ".maestro/_warmup.yaml";
const OWN_WORKFLOW: Record<string, string> = { "audio-soak.yaml": ".github/workflows/audio-soak.yml" };
const FELT_ONLY = "${{ !cancelled() && matrix.felt && steps.install.outcome == 'success' }}";

const job = (id: string): Job => {
  assert.ok(IOS.jobs[id], `no job ${id}`);
  return IOS.jobs[id];
};
const flows = job("flows");
const indexWhere = (j: Job, found: (s: Step) => boolean) => (j.steps ?? []).findIndex(found);
const shards = (flows.strategy?.matrix?.include as { shard: string; flows: string; felt?: boolean }[]).map((entry) => ({
  name: entry.shard,
  flows: entry.flows.trim().split(/\s+/),
  felt: entry.felt === true,
}));
const photographed = () => [...code(CAPTURES).matchAll(/takeScreenshot: ([\w-]+)/g)].map((m) => m[1]);
const run = (j: Job, name: string) => step(j, name).run ?? "";

test("every flow runs in exactly one shard, bar those another workflow drives", () => {
  const run = [...shards.flatMap((s) => s.flows), FELT, CAPTURES].sort();
  assert.equal(new Set(run).size, run.length, `a flow runs twice: ${run}`);
  const expected = readdirSync(path.join(root, ".maestro"))
    .filter((f) => f.endsWith(".yaml") && !f.startsWith("_") && !(f in OWN_WORKFLOW))
    .map((f) => `.maestro/${f}`)
    .sort();
  assert.deepEqual(run, expected);
  for (const [flow, workflow] of Object.entries(OWN_WORKFLOW)) assert.match(code(workflow), new RegExp(`\\.maestro/${flow}`));
});

test("the felt flow runs the captures last, and their screenshots are collected from it", () => {
  assert.match(code(FELT), /\n- runFlow: captures\.yaml\n?$/);
  const collect = run(flows, "Collect the capture states");
  const collected = /for shot in ([\w -]+); do/.exec(collect)![1].split(" ").sort();
  assert.deepEqual(collected, photographed().sort());
  assert.match(collect, /-path "\*\/felt-opaque\/\*"/);
});

test("each capture photographs the state its link opened", () => {
  const flow = code(CAPTURES);
  const opened = [...flow.matchAll(/openLink: "murlan:\/\/capture\?state=([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(opened, photographed());
  for (const id of opened) assert.ok(captureStateById(id), `${id} is not a capture state`);
});

test("a play flown in from a side seat is photographed", () => {
  const sides = photographed().flatMap((id) => {
    const state = captureStateById(id)!;
    const game = captureGameState(state);
    return capturePile(state) ? [seatDirection(game.lastPlayedBy, CAPTURE_VIEWER_SEAT, state.playerCount)] : [];
  });
  assert.ok(sides.some((side) => side === "left" || side === "right"), `piles photographed fly from: ${sides}`);
});

test("each shard runs its own flows, and exactly one photographs the felt", () => {
  assert.ok(shards.length > 1);
  const flowsStep = step(flows, "Run the flows");
  assert.equal(flowsStep.env?.FLOWS, "${{ matrix.flows }}");
  assert.match(flowsStep.run ?? "", /test -e MAESTRO_APP_ID="\$APP_ID" \$FLOWS\s*$/);
  assert.ok(!shards.some((s) => s.flows.includes(WARMUP)), "the warm-up runs first in every shard, never as a shard's own flow");
});

test("the warm-up runs before the flows, at most twice, and red when both attempts fail", () => {
  const warm = run(flows, "Warm up the simulator's input");
  assert.ok(stepIndex(flows, "Warm up the simulator's input") < stepIndex(flows, "Run the flows"));
  assert.match(warm, new RegExp(`for attempt in 1 2; do\\n\\s+maestro .*test -e MAESTRO_APP_ID="\\$APP_ID" ${WARMUP} && exit 0\\n`));
  assert.match(warm, /simctl bootstatus "\$SIMULATOR_UDID" -b\n\s*done\n\s*echo "::error::.*"\n\s*exit 1\s*$/);
  assert.doesNotMatch(run(flows, "Run the flows"), /for |retry|\|\|/);
  assert.doesNotMatch(JSON.stringify(flows), /continue-on-error/);
  assert.equal(shards.filter((s) => s.felt).length, 1);
  assert.equal(step(flows, "Install the app on the simulator").id, "install");
  const feltSteps = ["Photograph the felt", "The felt shows no black band and no black frame", "Upload the felt screenshots"];
  for (const name of [...feltSteps, "Collect the capture states", "Upload the capture states"]) {
    assert.equal(step(flows, name).if, FELT_ONLY, name);
  }
  assert.match(run(flows, "Photograph the felt"), new RegExp(`test -e MAESTRO_APP_ID="\\$APP_ID" ${FELT}\\s*$`));
  assert.equal(step(flows, "Upload the capture states").with?.name, "ios-captures");
});

test("the run is green only when every shard ran and passed", () => {
  assert.equal(flows.strategy?.["fail-fast"], false);
  const gate = job("ios");
  const jobs = Object.keys(IOS.jobs).filter((j) => j !== "ios");
  assert.deepEqual(needsOf(gate), jobs);
  assert.equal(gate.if, "always()");
  const passed = step(gate, "Every shard ran and passed");
  assert.equal(passed.env?.RESULTS, jobs.map((j) => `\${{ needs.${j}.result }}`).join(" "));
  assert.match(passed.run ?? "", new RegExp(`\\[ "\\$RESULTS" = "${jobs.map(() => "success").join(" ")}" \\]\\s*$`));
  assert.doesNotMatch(JSON.stringify(IOS), /continue-on-error/);
});

test("the gate judges the run's own jobs against its wall budget", () => {
  const gate = job("ios");
  assert.equal(gate.permissions?.actions, "read");
  const wall = step(gate, "The run finished within its wall budget");
  assert.equal(wall.env?.GH_TOKEN, "${{ github.token }}");
  assert.equal(wall.run?.trim(), `node tools/ci/ios-wall.mjs "${gate.name}"`);
  assert.ok(stepIndex(gate, "Every shard ran and passed") < stepIndex(gate, "The run finished within its wall budget"));
});

test("every load sampler is stopped once the debug output carrying its log is uploaded", () => {
  const sample = run(flows, "Sample the runner's load");
  const samplers = sample.match(/nohup top .*&\n/g) ?? [];
  assert.ok(samplers.length > 0);
  assert.equal((sample.match(/nohup top .*&\n\s*echo \$! >> "\$RUNNER_TEMP\/top\.pids"\n/g) ?? []).length, samplers.length);
  const stop = step(flows, "Stop sampling the runner's load");
  assert.equal(stop.if, "always()");
  assert.match(stop.run ?? "", /^kill \$\(cat "\$RUNNER_TEMP\/top\.pids"\)/);
  assert.ok(stepIndex(flows, "Upload Maestro debug output") < stepIndex(flows, "Stop sampling the runner's load"));
});

test("a shard boots beside the app job, which restores, and waits for the app it uploads", () => {
  const app = job("app");
  assert.ok(indexWhere(app, (s) => s.uses === "./.github/actions/ios-app") !== -1);
  assert.ok(!needsOf(flows).includes("app"));
  const upload = (app.steps ?? []).find((s) => s.uses?.startsWith("actions/upload-artifact@"));
  const uploaded = String(upload?.with?.name);
  assert.equal(flows.permissions?.actions, "read");
  const wait = indexWhere(flows, (s) => s.run?.trim() === `node tools/ci/await-artifact.mjs ${uploaded} "${app.name}"`);
  const download = indexWhere(flows, (s) => !!s.uses?.startsWith("actions/download-artifact@") && s.with?.name === uploaded);
  assert.ok(wait !== -1 && download !== -1 && wait < download, "the download waits on the app job's upload");
  assert.ok(stepIndex(flows, "Stop the simulator services no flow needs") < wait, "the simulator settles while the app job runs");
  assert.doesNotMatch(JSON.stringify(flows), /actions\/install|npm ci|actions\/ios-app|gh api/);
});

test("the simulator services no flow needs are found, disabled and gone before the app is installed", () => {
  const name = "Stop the simulator services no flow needs";
  const stopStep = step(flows, name);
  const stop = stopStep.run ?? "";
  assert.ok(stepIndex(flows, name) < stepIndex(flows, "Install the app on the simulator"));
  const services = String(stopStep.env?.SERVICES).trim().split(/\s+/);
  for (const host of ["com.apple.apsd", "com.apple.chronod", "com.apple.PosterBoard"]) assert.ok(services.includes(host), host);
  assert.match(stop, /for label in \$SERVICES; do\n.*'\$3 == label \{ found = 1 \} END \{ exit !found \}' \|\|\n\s*\{ echo "::error::.*"; exit 1; \}\n\s*pids="\$pids \$\(pid_of "\$label"\)"\n/);
  assert.match(stop, /extensions=\$\(pgrep -f "\$EXTENSIONS".*\n.*\[ -n "\$extensions" \] \|\| \{ echo "::error::.*"; exit 1; \}\n\s*pids="\$pids \$extensions"\n/);
  assert.match(stop, /launchctl disable "system\/\$label"\n/);
  assert.match(stop, /\) &\n\s*stoppers="\$stoppers \$!"\n\s*done\n\s*for stopper in \$stoppers; do wait "\$stopper"; done\n/);
  assert.match(stop, /pkill -f "\$EXTENSIONS"/);
  assert.match(stop, /for pid in \$pids; do kill -0 "\$pid" 2> \/dev\/null && alive=/);
  assert.match(stop, /for label in \$SERVICES; do \[ -z "\$\(pid_of "\$label"\)" \] \|\| alive=/);
  assert.match(stop, /\[ -z "\$alive" \] && \{ .*exit 0; \}\n[\s\S]*echo "::error::.*"\n\s*exit 1\s*$/);
});
