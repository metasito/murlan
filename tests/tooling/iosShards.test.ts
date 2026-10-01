import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const code = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/[ \t]*#.*$/gm, "");
const IOS = code(".github/workflows/ios.yml");
const FELT = ".maestro/felt-opaque.yaml";
const WARMUP = ".maestro/_warmup.yaml";
const OWN_WORKFLOW: Record<string, string> = { "audio-soak.yaml": ".github/workflows/audio-soak.yml" };

const job = (id: string) => {
  const start = IOS.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, `no job ${id}`);
  const next = IOS.slice(start + 1).search(/\n {2}[\w-]+:\n/);
  return IOS.slice(start, next === -1 ? undefined : start + 1 + next);
};
const shards = job("flows")
  .split(/\n {10}- shard: /)
  .slice(1)
  .map((entry) => ({
    name: entry.split("\n")[0].trim(),
    flows: /\n {12}flows: (.+)/.exec(entry)![1].trim().split(/\s+/),
    felt: /\n {12}felt: true\b/.test(entry),
  }));
const step = (source: string, name: string) => {
  const start = source.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `no step named "${name}"`);
  const end = source.indexOf("\n      - ", start);
  return source.slice(start, end === -1 ? undefined : end);
};

test("every flow runs in exactly one shard, bar those another workflow drives", () => {
  const run = [...shards.flatMap((s) => s.flows), FELT].sort();
  assert.equal(new Set(run).size, run.length, `a flow runs twice: ${run}`);
  const expected = readdirSync(path.join(root, ".maestro"))
    .filter((f) => f.endsWith(".yaml") && !(f in OWN_WORKFLOW))
    .map((f) => `.maestro/${f}`)
    .filter((f) => f !== WARMUP)
    .sort();
  assert.deepEqual(run, expected);
  for (const [flow, workflow] of Object.entries(OWN_WORKFLOW)) assert.match(code(workflow), new RegExp(`\\.maestro/${flow}`));
});

test("each shard runs its own flows, and exactly one photographs the felt", () => {
  assert.ok(shards.length > 1);
  assert.match(step(IOS, "Run the flows"), /FLOWS: \$\{\{ matrix\.flows \}\}[\s\S]*test -e MAESTRO_APP_ID="\$APP_ID" \$FLOWS\n/);
  assert.ok(!shards.some((s) => s.flows.includes(WARMUP)), "the warm-up runs first in every shard, never as a shard's own flow");
});

test("the warm-up runs before the flows, at most twice, and red when both attempts fail", () => {
  const warm = step(IOS, "Warm up the simulator's input");
  assert.ok(IOS.indexOf("- name: Warm up the simulator's input") < IOS.indexOf("- name: Run the flows"));
  assert.match(warm, new RegExp(`for attempt in 1 2; do\\n\\s+maestro .*test -e MAESTRO_APP_ID="\\$APP_ID" ${WARMUP} && exit 0\\n`));
  assert.match(warm, /simctl bootstatus "\$SIMULATOR_UDID" -b\n\s+done\n\s+echo "::error::.*"\n\s+exit 1\s*$/);
  assert.doesNotMatch(step(IOS, "Run the flows"), /for |retry|\|\|/);
  assert.doesNotMatch(job("flows"), /continue-on-error/);
  assert.equal(shards.filter((s) => s.felt).length, 1);
  assert.match(step(IOS, "Install the app on the simulator"), /\n {8}id: install\n/);
  for (const name of ["Photograph the felt", "The felt shows no black band", "Upload the felt screenshots"]) {
    assert.match(step(IOS, name), /if: \$\{\{ !cancelled\(\) && matrix\.felt && steps\.install\.outcome == 'success' \}\}\n/, name);
  }
  assert.match(step(IOS, "Photograph the felt"), new RegExp(`test -e MAESTRO_APP_ID="\\$APP_ID" ${FELT}\\n`));
});

test("the run is green only when every shard ran and passed", () => {
  assert.match(job("flows"), /fail-fast: false\n/);
  const gate = job("ios");
  const jobs = [...IOS.split(/^jobs:\n/m)[1].matchAll(/^ {2}([\w-]+):\n/gm)].map((m) => m[1]).filter((j) => j !== "ios");
  assert.match(gate, new RegExp(`\\n {4}needs: \\[${jobs.join(", ")}\\]\\n`));
  assert.match(gate, /\n {4}if: always\(\)\n/);
  const results = jobs.map((j) => `\\$\\{\\{ needs\\.${j}\\.result \\}\\}`).join(" ");
  const expected = jobs.map(() => "success").join(" ");
  assert.match(step(gate, "Every shard ran and passed"), new RegExp(`RESULTS: ${results}\\n[\\s\\S]*\\[ "\\$RESULTS" = "${expected}" \\]\\s*$`));
  assert.doesNotMatch(IOS, /continue-on-error/);
});

test("a shard needs the app job, which restores, and downloads the app it uploaded", () => {
  assert.match(job("app"), /uses: \.\/\.github\/actions\/ios-app\n/);
  assert.match(job("flows"), /\n {4}needs: app\n/);
  const uploaded = /upload-artifact@.*\n {8}with:\n {10}name: (.+)\n/.exec(job("app"))![1];
  assert.match(job("flows"), new RegExp(`download-artifact@.*\\n {8}with:\\n {10}name: ${uploaded}\\n`));
  assert.doesNotMatch(job("flows"), /actions\/install|npm ci|actions\/ios-app|gh api/);
});

test("the simulator services no flow needs are found running, disabled and gone before the app is installed", () => {
  const name = "Stop the simulator services no flow needs";
  const stop = step(IOS, name);
  assert.ok(IOS.indexOf(`- name: ${name}`) < IOS.indexOf("- name: Install the app on the simulator"));
  const services = /SERVICES: >-\n((?: {12}.+\n)+)/.exec(stop)![1].trim().split(/\s+/);
  for (const host of ["com.apple.apsd", "com.apple.chronod", "com.apple.PosterBoard"]) assert.ok(services.includes(host), host);
  assert.match(stop, /for label in \$SERVICES; do\n\s+pid=\$\(pid_of "\$label"\)\n\s+\[ -n "\$pid" \] \|\| \{ echo "::error::.*"; exit 1; \}\n/);
  assert.match(stop, /\[ "\$extensions" -gt 0 \] \|\| \{ echo "::error::.*"; exit 1; \}\n/);
  assert.match(stop, /launchctl disable "system\/\$label"\n/);
  assert.match(stop, /pkill -f "\$EXTENSIONS"/);
  assert.match(stop, /for pid in \$pids; do kill -0/);
  assert.match(stop, /pgrep -f "\$EXTENSIONS" > \/dev\/null && alive=/);
  assert.match(stop, /\[ -z "\$alive" \] && \{ .*exit 0; \}\n[\s\S]*echo "::error::.*"\n\s+exit 1\s*$/);
});
