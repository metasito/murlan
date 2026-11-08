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

const READY_LINE = "express server ready on port";

test("the e2e webServer binds PORT=0 and Playwright waits for the server to say where", () => {
  const server = readFileSync("scripts/e2e-server.mjs", "utf8");
  assert.match(server, /^const PORT = String\(PLAY \? PLAY_PORT : 0\);$/m, "the e2e server is told a port to bind other than 0");
  const config = readFileSync("tests/e2e/playwright.config.ts", "utf8");
  const webServer = config.slice(config.indexOf("webServer:"));
  assert.ok(webServer.length > "webServer:".length, "the scan no longer finds the webServer block");
  assert.match(webServer, new RegExp(`wait:\\s*\\{\\s*stdout:\\s*/${READY_LINE} \\(\\?<e2e_port>`), "the webServer is not awaited on the server's announcement");
  assert.doesNotMatch(webServer, /\burl:|\bport:/, "the webServer is awaited on an address chosen before it binds");
  assert.doesNotMatch(config, /\bbaseURL:/, "the base URL is fixed before the server has a port");
  assert.match(readFileSync("tests/e2e/fixtures.ts", "utf8"), /process\.env\.E2E_PORT/, "nothing hands the captured port to the specs");
});

test("every supervisor waits on the line the server logs once it is ready", () => {
  assert.ok(readFileSync("server/index.ts", "utf8").includes(`${READY_LINE} \${bound}`), "the server no longer logs the ready line");
  assert.ok(readFileSync("tests/helpers/instance.ts", "utf8").includes(READY_LINE), "boot() no longer waits on the ready line");
});
