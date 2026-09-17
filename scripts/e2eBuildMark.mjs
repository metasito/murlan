#!/usr/bin/env node
// Reads built output for lib/e2eBuildMark.ts's string.
//   node scripts/e2eBuildMark.mjs --absent dist static-build   a production build
//   node scripts/e2eBuildMark.mjs --present dist-e2e           the e2e build, so the mark is known to work
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_BUILD_MARK = "murlan-e2e-build";

export function filesCarryingMark(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && fs.readFileSync(path.join(e.parentPath, e.name)).includes(E2E_BUILD_MARK))
    .map((e) => path.join(e.parentPath, e.name));
}

export function assertMark(mode, dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) throw new Error(`${dir} does not exist — nothing was built there`);
    const found = filesCarryingMark(dir);
    if (mode === "--absent" && found.length > 0) {
      throw new Error(`${dir} was built with a test-only EXPO_PUBLIC_E2E_* flag:\n  ${found.join("\n  ")}`);
    }
    if (mode === "--present" && found.length === 0) {
      throw new Error(`${dir} carries no ${E2E_BUILD_MARK} — the mark no longer survives a flagged build`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...dirs] = process.argv.slice(2);
  if (!["--absent", "--present"].includes(mode) || dirs.length === 0) {
    console.error("usage: e2eBuildMark.mjs --absent|--present <dir>...");
    process.exit(2);
  }
  try {
    assertMark(mode, dirs);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
