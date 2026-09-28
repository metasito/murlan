#!/usr/bin/env node
// Reads built output for lib/e2eBuildMark.ts's string.
//   node scripts/e2eBuildMark.mjs --absent|--present <dir>... [--mark e2e|diagnostics]
//   node scripts/e2eBuildMark.mjs --present dist-e2e   the e2e build, so the mark is known to work
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_BUILD_MARK = "murlan-e2e-build";
export const DIAGNOSTICS_MARK = "murlan-diagnostics-recorder";
const MARKS = { e2e: E2E_BUILD_MARK, diagnostics: DIAGNOSTICS_MARK };

export function filesCarryingMark(dir, mark = E2E_BUILD_MARK) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && fs.readFileSync(path.join(e.parentPath, e.name)).includes(mark))
    .map((e) => path.join(e.parentPath, e.name));
}

export function assertMark(mode, dirs, mark = E2E_BUILD_MARK) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) throw new Error(`${dir} does not exist — nothing was built there`);
    const found = filesCarryingMark(dir, mark);
    if (mode === "--absent" && found.length > 0) {
      throw new Error(`${dir} carries ${mark}, which only a flagged build may:\n  ${found.join("\n  ")}`);
    }
    if (mode === "--present" && found.length === 0) {
      throw new Error(`${dir} carries no ${mark} — the mark no longer survives a flagged build`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--mark");
  const mark = at === -1 ? E2E_BUILD_MARK : MARKS[args[at + 1]];
  const [mode, ...dirs] = at === -1 ? args : args.slice(0, at);
  if (!mark || !["--absent", "--present"].includes(mode) || dirs.length === 0) {
    console.error("usage: e2eBuildMark.mjs --absent|--present <dir>... [--mark e2e|diagnostics]");
    process.exit(2);
  }
  try {
    assertMark(mode, dirs, mark);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
