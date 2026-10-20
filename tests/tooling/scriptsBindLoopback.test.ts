// tests/tooling/scriptsBindLoopback.test.ts — a script that publishes a port on every interface is a LAN exposure (#1760).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts");

/** Each entry is one exact offender and states why it may listen beyond loopback. */
const ALLOWED: Record<string, string> = {
  "diagnostics-collector.mjs: .listen(5099, \"0.0.0.0\", ()": "the phone posts bench rows to the PC over the LAN; the body and file are capped instead",
  "dev-stack.mjs: .listen(${port},'0.0.0.0',()": "canBind is a probe that opens and closes at once; it must see a port held on any interface",
};

const LOOPBACK = /^(["'`])(127\.0\.0\.1|localhost|::1)\1$/;

function offenders(name: string, src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(/\.listen\(([^)]*)\)/g)) {
    const host = m[1]!.split(",")[1]?.trim() ?? "";
    if (!LOOPBACK.test(host)) found.push(`${name}: .listen(${m[1]})`);
  }
  for (const m of src.matchAll(/"-p",\s*`([^`]*)`|"-p",\s*"([^"]*)"/g)) {
    const spec = m[1] ?? m[2] ?? "";
    if (/:\d|\$\{/.test(spec) && !spec.startsWith("127.0.0.1:")) found.push(`${name}: docker -p ${spec}`);
  }
  return found;
}

function scanned(): string[] {
  const found: string[] = [];
  for (const name of readdirSync(scriptsDir, { recursive: true, encoding: "utf8" })) {
    if (/\.(mjs|js|ts)$/.test(name)) found.push(...offenders(name, readFileSync(path.join(scriptsDir, name), "utf8")));
  }
  return found;
}

test("every listen and docker publish in scripts/ is loopback, or named with its reason", () => {
  assert.deepEqual(scanned().filter((o) => !(o in ALLOWED)), []);
});

test("the scan sees a wildcard listen and an unprefixed publish", () => {
  assert.equal(offenders("x", `s.listen(1, "0.0.0.0", f)`).length, 1);
  assert.equal(offenders("x", `s.listen(1)`).length, 1);
  assert.equal(offenders("x", `"-p", \`\${p}:5432\``).length, 1);
  assert.deepEqual(offenders("x", `s.listen(1, "127.0.0.1", f)`), []);
  assert.deepEqual(offenders("x", `"-p", \`127.0.0.1:\${p}:5432\``), []);
});

test("every allowlist entry still matches an offender", () => {
  const found = new Set(scanned());
  assert.deepEqual(Object.keys(ALLOWED).filter((o) => !found.has(o)), []);
});
