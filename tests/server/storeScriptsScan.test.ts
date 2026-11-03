// tests/server/storeScriptsScan.test.ts — Lua reaches the store from one file: the rate limiters,
// whose live-only decrement has no Valkey 9.1 command. Everything else uses Valkey's own commands
// (tests/integration/tableOwnerRecords.test.ts, instanceInbox.test.ts, sharedRateLimits.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const ALLOWED = "server/http/rateLimit.ts";

const SCRIPT_SENDS = [
  /\.\s*(?:eval|evalRo|evalSha|evalShaRo|scriptLoad|fCall|fCallRo|functionLoad)\s*\(/gi,
  /["'`](?:EVAL|EVAL_RO|EVALSHA|EVALSHA_RO|FCALL|FCALL_RO)["'`]/gi,
  /["'`](?:SCRIPT|FUNCTION)["'`]/g,
  /\bdefineScript\s*\(/g,
];

function scriptSends(source: string): string[] {
  const code = blankComments(source);
  return SCRIPT_SENDS.flatMap((pattern) => [...code.matchAll(pattern)].map(([hit]) => hit));
}

test("the scan sees every way a script is sent", () => {
  for (const planted of [
    `await client.eval(SRC, { keys: [k] });`,
    `client.evalSha(sha, { keys: [k] })`,
    `client.sendCommand(["EVAL", SRC, "1", k])`,
    `sendCommand(['evalsha', sha, '0'])`,
    `client.sendCommand(["SCRIPT", "LOAD", SRC])`,
    `const s = defineScript({ SCRIPT: SRC, NUMBER_OF_KEYS: 1 })`,
    "client.fCall(`name`, {})",
  ]) {
    assert.notDeepEqual(scriptSends(planted), [], `missed: ${planted}`);
  }
  assert.deepEqual(scriptSends(`// client.eval(SRC)\nclient.sendCommand(["DELIFEQ", k, v]);\nconst csp = "'wasm-unsafe-eval'";`), []);
});

test("no file but the rate limiters sends Lua to the store", () => {
  const sources = sourcesUnder(repoRoot, ["server"], /\.ts$/);
  const scanned = sources.map(([file]) => file);
  for (const file of ["server/store/tableOwners.ts", "server/store/instanceInbox.ts", "server/store/presence.ts", ALLOWED]) {
    assert.ok(scanned.includes(file), `${file} was not scanned`);
  }
  assert.ok(scanned.length > 50, `only ${scanned.length} server files scanned`);
  const hits = sources.flatMap(([file, src]) => scriptSends(src).map((hit) => `${file}: ${hit}`));
  assert.ok(hits.some((hit) => hit.startsWith(`${ALLOWED}:`)), "the rate limiters' script is not where the scan looks");
  assert.deepEqual(hits.filter((hit) => !hit.startsWith(`${ALLOWED}:`)), []);
});
