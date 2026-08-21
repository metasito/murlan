#!/usr/bin/env node
// Metro's --source-maps flag embeds sourcesContent — the original unminified
// source — in every .map it writes next to its .js in dist/. server/app.ts
// serves dist/ wholesale, so a map left there is the source shipped to
// anyone who asks. This moves every .map out to sourcemaps/, read only by
// server/sourceMaps.ts, never mounted as static.
//
// Run with: node scripts/moveSourceMaps.mjs (after `expo export --source-maps`)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const MAPS = path.join(ROOT, "sourcemaps");

function findMaps(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findMaps(full, out);
    else if (entry.name.endsWith(".map")) out.push(full);
  }
  return out;
}

const maps = fs.existsSync(DIST) ? findMaps(DIST) : [];
for (const src of maps) {
  const dest = path.join(MAPS, path.relative(DIST, src));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}
console.log(
  maps.length > 0
    ? `Moved ${maps.length} source map(s) out of dist/ into sourcemaps/.`
    : "No .map files under dist/ — was expo export run with --source-maps?"
);
