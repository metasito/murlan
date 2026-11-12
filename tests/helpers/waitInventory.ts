import { readFileSync } from "node:fs";
import path from "node:path";
import { fixedSleeps } from "./sleepScan.ts";
import { blankComments, sourcesUnder } from "./sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export const WAIT_INVENTORY = "tests/fixtures/waitInventory.json";
export const SCANNED = ["tests/integration", "tests/server", "tests/helpers"];

export type Entry = { n: number; why: string };
/** `waits`: fixed real-time waits; `windows`: `nothingArrives` calls that widen their window. Exact counts, by file. */
export type Inventory = { waits: Record<string, Entry>; windows: Record<string, Entry> };

const CODE = /\.(?:[cm]?[jt]s|tsx)$/;

export const sources = (): [string, string][] => sourcesUnder(repoRoot, SCANNED, CODE);

/** The `nothingArrives(...)` calls in `code` whose options set `ms`, by file. */
export function widenedWindows(files: [string, string][]): Map<string, number> {
  const found = new Map<string, number>();
  for (const [file, src] of files) {
    const code = blankComments(src);
    for (const m of code.matchAll(/(?<!function\s+)\bnothingArrives\s*(?:<[^>(]*>)?\(/g)) {
      let depth = 1;
      let end = m.index + m[0].length;
      for (; end < code.length && depth > 0; end++) {
        if (code[end] === "(") depth++;
        else if (code[end] === ")") depth--;
      }
      if (/\bms\s*[:,}]/.test(code.slice(m.index + m[0].length, end))) found.set(file, (found.get(file) ?? 0) + 1);
    }
  }
  return found;
}

/** The fixed waits' line numbers, by file. */
export function fixedWaits(files: [string, string][]): Map<string, number[]> {
  const lines = new Map<string, number[]>();
  for (const s of fixedSleeps(files)) lines.set(s.file, [...(lines.get(s.file) ?? []), s.line]);
  return lines;
}

export const readInventory = (): Inventory => JSON.parse(readFileSync(path.join(repoRoot, WAIT_INVENTORY), "utf8"));

/**
 * The inventory with each count lowered to what the scan found, and a file that has none left
 * dropped. Never raised: a wait the inventory does not cover needs a person to say why it is
 * about real time, so it comes back in `unlisted` and the inventory is left short of it.
 */
export function lowered(inventory: Record<string, Entry>, found: Map<string, number>): { inventory: Record<string, Entry>; unlisted: string[] } {
  const next: Record<string, Entry> = {};
  for (const [file, entry] of Object.entries(inventory)) {
    const n = Math.min(entry.n, found.get(file) ?? 0);
    if (n > 0) next[file] = { ...entry, n };
  }
  const unlisted = [...found]
    .filter(([file, n]) => n > (inventory[file]?.n ?? 0))
    .map(([file, n]) => `${file}: ${n} found, ${inventory[file]?.n ?? 0} listed`);
  return { inventory: next, unlisted };
}
