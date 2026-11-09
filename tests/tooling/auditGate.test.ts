import { test } from "node:test";
import assert from "node:assert/strict";
import { fixableSevere, run } from "../../tools/ci/audit-gate.mjs";

const vuln = (severity: string, fixAvailable: unknown) => ({ severity, fixAvailable });
const report = (vulnerabilities: object) => JSON.stringify({ vulnerabilities });

test("a critical or high advisory with a non-major fix fails; a major fix does not", () => {
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  assert.equal(run(() => report({ a: vuln("critical", { name: "a", isSemVerMajor: false }) }), log), 1);
  assert.equal(run(() => report({ b: vuln("high", true) }), log), 1);
  assert.equal(run(() => report({ c: vuln("high", { name: "c", isSemVerMajor: true }) }), log), 0);
  assert.equal(run(() => report({ d: vuln("moderate", { name: "d", isSemVerMajor: false }) }), log), 0);
  assert.equal(run(() => report({ e: vuln("high", false) }), log), 0);
});

test("output that is not an audit report fails rather than passing unseen", () => {
  assert.equal(run(() => "", () => {}), 1);
  assert.equal(run(() => "npm ERR! network", () => {}), 1);
  assert.equal(fixableSevere({}), null);
});

test("ci.yml's lint job runs the audit gate", async () => {
  const { readFileSync } = await import("node:fs");
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const lint = ci.slice(ci.indexOf("\n  lint:\n"), ci.indexOf("\n  android-build:"));
  assert.match(lint, /run: node tools\/ci\/audit-gate\.mjs/);
});

test("a dependent flagged only through a package with no non-major fix does not fail", () => {
  const major = { name: "expo", isSemVerMajor: true };
  const via = [{ source: 1, name: "forge" }];
  assert.equal(run(() => report({ forge: { ...vuln("high", major), via }, dep: { ...vuln("high", true), via: ["forge"] } }), () => {}), 0);
  assert.equal(run(() => report({ forge: { ...vuln("high", true), via }, dep: { ...vuln("high", true), via: ["forge"] } }), () => {}), 1);
});

test("a pull request fails only on a package its lockfile touches", async () => {
  const { touchedPackages } = await import("../../tools/ci/audit-gate.mjs");
  const lock = (packages: object) => JSON.stringify({ packages });
  const base = lock({ "": {}, "node_modules/forge": { version: "1.0.0" }, "node_modules/a/node_modules/b": { version: "1.0.0" } });
  const head = lock({ "": {}, "node_modules/forge": { version: "1.0.0" }, "node_modules/a/node_modules/b": { version: "1.1.0" }, "node_modules/c": { version: "2.0.0" } });
  const touched = touchedPackages(base, head);
  assert.deepEqual([...touched!].sort(), ["b", "c"]);
  assert.equal(touchedPackages("nope", head), null);
  const severe = report({ forge: vuln("high", true), b: vuln("high", true) });
  assert.equal(run(() => severe, () => {}, touched), 1);
  assert.equal(run(() => report({ forge: vuln("high", true) }), () => {}, touched), 0);
  assert.equal(run(() => report({ forge: vuln("high", true) }), () => {}, null), 1);
});

test("ci.yml scopes the audit to the lockfile diff on a pull request only", async () => {
  const { readFileSync } = await import("node:fs");
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /audit-gate\.mjs \$\{\{ github\.event_name == 'pull_request' && format\('--base \{0\}', github\.event\.pull_request\.base\.sha\)/);
});
