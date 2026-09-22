import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const HOST_COUPLING = /REPLIT_\w*|neon\.tech|replit\.com/g;

test("the server, the build and the app config name no host", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const sources: [string, string][] = [
    ...sourcesUnder(repoRoot, ["server", "scripts"], /\.(ts|js|mjs|cjs)$/),
    ["package.json scripts", JSON.stringify(pkg.scripts)],
    ["app.json", readFileSync(path.join(repoRoot, "app.json"), "utf8")],
  ];

  assert.ok(sources.some(([file]) => file === "server/index.ts"), "the scan walked no server source");
  assert.deepEqual(scanSources(HOST_COUPLING, sources), []);
});
