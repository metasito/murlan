// tests/tooling/integrationPorts.test.ts — a test server on a port the test chose can be one another
// file running beside it chose too, and two servers on one port fail each other's requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const sources = (dir: string) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(test\.)?ts$/.test(f))
    .map((f) => ({ file: `${dir}/${f}`, source: readFileSync(`${dir}/${f}`, "utf8") }));

test("a test that spawns the server lets the OS choose its port", () => {
  const spawners = sources("tests").filter(
    ({ source }) => /\bspawn(Sync)?\(/.test(source) && /server\/index\.ts|"server", "index\.ts"/.test(source)
  );
  assert.ok(
    spawners.some(({ file }) => file === "tests/helpers/instance.ts"),
    `the scan no longer finds tests/helpers/instance.ts among the server spawners: ${spawners.map((s) => s.file).join(", ")}`
  );
  const chosen = spawners.filter(({ source }) => !/\bPORT: "0"/.test(source) || /\bPORT: (?:String\(|`|"[1-9]|\d)/.test(source));
  assert.deepEqual(chosen.map((s) => s.file), [], "these spawn the server on a PORT other than \"0\"");
});

test("an integration server listens on a port the OS chose", () => {
  const files = [...sources("tests/integration"), ...sources("tests/helpers")];
  const listeners = files.filter(({ source }) => /\.listen\(/.test(source));
  assert.ok(listeners.length >= 3, `found only ${listeners.length} files that listen — the scan no longer reads them`);
  const fixed = files.filter(({ source }) => /\.listen\(\s*(?:\{\s*port:\s*)?[1-9]/.test(source));
  assert.deepEqual(fixed.map((f) => f.file), [], "these listen on a fixed port");
});
