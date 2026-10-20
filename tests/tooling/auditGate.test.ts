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
