// `npm run regen`: rewrites the committed outputs of other checks from the tree they describe,
// so a red one is fixed by one command rather than by reading its message and editing by hand.
//
//   npm run regen                        protocol and stored-shape hashes, timings.json's gone
//                                        specs, the wait inventory's lowered counts
//   npm run regen -- --from-run <id>     also online-table.txt, from the rows a red CI run of
//                                        onlineTableSurvey.spec.ts measured at this HEAD
//
// It refuses, and exits 1, wherever the fix is a person's call: a hash changed under a version
// origin/main already records (bump it), a wait no entry explains (say why), a run of another
// commit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import { atMain, withEntry } from "../tests/helpers/appendOnly.ts";
import { PROTOCOL_HASHES, protocolHash } from "../tests/helpers/protocolHash.ts";
import { DOCUMENTS, type Document, shapeHashes, STORED_SHAPES } from "../tests/helpers/storedShapes.ts";
import { fixedWaits, lowered, readInventory, sources, WAIT_INVENTORY, widenedWindows } from "../tests/helpers/waitInventory.ts";
import { MEASURED_ROWS, mergedRecord, ONLINE_TABLE } from "../tests/e2e/helpers/onlineTableRecord.ts";
import { readTimings, specFilesIn } from "../tools/ci/e2e-shard.mjs";
import { withoutGone } from "../tools/ci/e2e-timings.mjs";
import { isInvokedDirectly } from "./lib/entry.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export type Output = { file: string; next: string } | { file: string; refused: string };

const NO_MAIN = "origin/main cannot be read: run `git fetch origin main`, so no entry it records is written over";

function protocolHashes(): Output {
  const main = atMain(PROTOCOL_HASHES) as Record<string, string> | undefined;
  if (!main) return { file: PROTOCOL_HASHES, refused: NO_MAIN };
  const entry = withEntry(main, PROTOCOL_VERSION, protocolHash(read("shared/protocol.ts")));
  return "refused" in entry
    ? { file: PROTOCOL_HASHES, refused: `shared/protocol.ts changed, but ${entry.refused}: bump PROTOCOL_VERSION in shared/protocol.ts` }
    : { file: PROTOCOL_HASHES, next: json(entry.record) };
}

function storedShapes(): Output {
  const main = atMain(STORED_SHAPES) as Partial<Record<Document, Record<string, string>>> | undefined;
  if (!main) return { file: STORED_SHAPES, refused: NO_MAIN };
  const hashes = shapeHashes();
  const next: Partial<Record<Document, Record<string, string>>> = {};
  for (const name of Object.keys(DOCUMENTS) as Document[]) {
    const entry = withEntry(main[name] ?? {}, DOCUMENTS[name].version, hashes[name]);
    if ("refused" in entry) return { file: STORED_SHAPES, refused: `the stored ${name} shape changed, but ${entry.refused}: bump ${DOCUMENTS[name].bump}` };
    next[name] = entry.record;
  }
  return { file: STORED_SHAPES, next: json(next) };
}

function timings(): Output {
  return { file: "tests/e2e/timings.json", next: json(withoutGone(readTimings(), specFilesIn())) };
}

function waitInventory(): Output {
  const files = sources();
  const inventory = readInventory();
  const waits = lowered(inventory.waits, new Map([...fixedWaits(files)].map(([file, lines]) => [file, lines.length])));
  const windows = lowered(inventory.windows, widenedWindows(files));
  const unlisted = [...waits.unlisted.map((u) => `waits: ${u}`), ...windows.unlisted.map((u) => `windows: ${u}`)];
  return unlisted.length
    ? { file: WAIT_INVENTORY, refused: `entries a person has to write, with why each is real time: ${unlisted.join("; ")}` }
    : { file: WAIT_INVENTORY, next: json({ waits: waits.inventory, windows: windows.inventory }) };
}

/** Every output computed from this tree, none written. */
export function outputs(): Output[] {
  return [protocolHashes(), storedShapes(), timings(), waitInventory()];
}

/** Every `MEASURED_ROWS` file under `dir`, its rows in path order. */
export function measuredRows(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => path.basename(f) === MEASURED_ROWS)
    .sort()
    .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean));
}

function fromRun(runId: string): Output {
  const gh = (args: string[]) => execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const ran = gh(["api", `repos/{owner}/{repo}/actions/runs/${runId}`, "--jq", ".head_sha"]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (ran !== head) return { file: ONLINE_TABLE, refused: `run ${runId} measured ${ran}, not HEAD ${head}: its rows describe another tree` };
  const dir = mkdtempSync(path.join(tmpdir(), "regen-"));
  try {
    gh(["run", "download", runId, "--pattern", "playwright-test-results-*", "--dir", dir]);
    const rows = measuredRows(dir);
    return rows.length
      ? { file: ONLINE_TABLE, next: mergedRecord(read(ONLINE_TABLE), rows) }
      : { file: ONLINE_TABLE, refused: `run ${runId} left no ${MEASURED_ROWS}: the survey passed there, or went red before it measured` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv: string[]): number {
  const at = argv.indexOf("--from-run");
  const runId = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && !/^\d+$/.test(runId ?? "")) throw new Error("usage: npm run regen [-- --from-run <run id>]");
  let refused = 0;
  for (const out of [...outputs(), ...(runId ? [fromRun(runId)] : [])]) {
    if ("refused" in out) {
      refused++;
      process.stdout.write(`refused  ${out.file}: ${out.refused}\n`);
    } else if (out.next === read(out.file)) {
      process.stdout.write(`current  ${out.file}\n`);
    } else {
      writeFileSync(path.join(root, out.file), out.next);
      process.stdout.write(`wrote    ${out.file}\n`);
    }
  }
  return refused ? 1 : 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = main(process.argv.slice(2));
