// `npm run regen`: rewrites the committed outputs of other checks from the tree they describe,
// so a red one is fixed by one command rather than by reading its message and editing by hand.
//
//   npm run regen                        protocol and stored-shape hashes, timings.json's gone
//                                        specs, the wait inventory's lowered counts
//   npm run regen -- --from-run <id>     also online-table.txt and its captures, from what a red
//                                        CI run of onlineTableSurvey.spec.ts measured at this tree
//
// It refuses, and exits 1, wherever the fix is a person's call: a hash changed under a version
// origin/main already records (bump it), a wait no entry explains (say why), a run of another tree.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import { atMain, withEntry } from "../tests/helpers/appendOnly.ts";
import { PROTOCOL_HASHES, protocolHash } from "../tests/helpers/protocolHash.ts";
import { DOCUMENTS, type Document, shapeHashes, STORED_SHAPES } from "../tests/helpers/storedShapes.ts";
import { fixedWaits, lowered, readInventory, sources, WAIT_INVENTORY, widenedWindows } from "../tests/helpers/waitInventory.ts";
import {
  CAPTURES,
  captureName,
  MEASURED_ROWS,
  mergedRecord,
  ONLINE_TABLE,
  parseMeasured,
  RESULTS_ARTIFACT,
  VIEWPORTS,
} from "../tests/e2e/helpers/onlineTableRecord.ts";
import { readTimings, specFilesIn, TIMINGS } from "../tools/ci/e2e-shard.mjs";
import { withoutGone } from "../tools/ci/e2e-timings.mjs";
import { isInvokedDirectly } from "./lib/entry.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export type Output = { file: string; next: string | Buffer; dropped?: string[] } | { file: string; refused: string };

const NO_MAIN = "origin/main cannot be read: run `git fetch origin main`, so no entry it records is written over";

function protocolHashes(): Output {
  const main = atMain(PROTOCOL_HASHES) as Record<string, string> | undefined;
  if (!main) return { file: PROTOCOL_HASHES, refused: NO_MAIN };
  const entry = withEntry(main, JSON.parse(read(PROTOCOL_HASHES)), PROTOCOL_VERSION, protocolHash(read("shared/protocol.ts")));
  return "refused" in entry
    ? { file: PROTOCOL_HASHES, refused: `shared/protocol.ts changed, but ${entry.refused}: bump PROTOCOL_VERSION in shared/protocol.ts` }
    : { file: PROTOCOL_HASHES, next: json(entry.record), dropped: entry.dropped };
}

function storedShapes(): Output {
  const main = atMain(STORED_SHAPES) as Partial<Record<Document, Record<string, string>>> | undefined;
  if (!main) return { file: STORED_SHAPES, refused: NO_MAIN };
  const branch: Partial<Record<Document, Record<string, string>>> = JSON.parse(read(STORED_SHAPES));
  const hashes = shapeHashes();
  const next: Partial<Record<Document, Record<string, string>>> = {};
  const dropped: string[] = [];
  for (const name of Object.keys(DOCUMENTS) as Document[]) {
    const entry = withEntry(main[name] ?? {}, branch[name] ?? {}, DOCUMENTS[name].version, hashes[name]);
    if ("refused" in entry) return { file: STORED_SHAPES, refused: `the stored ${name} shape changed, but ${entry.refused}: bump ${DOCUMENTS[name].bump}` };
    next[name] = entry.record;
    dropped.push(...entry.dropped.map((v) => `${name} ${v}`));
  }
  return { file: STORED_SHAPES, next: json(next), dropped };
}

function timings(): Output {
  return { file: path.relative(root, TIMINGS).split(path.sep).join("/"), next: json(withoutGone(readTimings(), specFilesIn())) };
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

/**
 * The record and captures the survey's output dirs under `dir` hold, applied to `record`. Only
 * rows measured on `tree` are taken: a pull request's run measures its merge with main, which is
 * this checkout's tree only once main is merged in.
 */
export function fromMeasured(dir: string, tree: string, record: string): Output[] {
  const found = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => path.basename(f) === MEASURED_ROWS)
    .sort()
    .map((f) => ({ at: path.join(dir, path.dirname(f)), ...parseMeasured(readFileSync(path.join(dir, f), "utf8")) }));
  if (!found.length) return [{ file: ONLINE_TABLE, refused: `no ${MEASURED_ROWS}: the survey passed there, or went red before it measured` }];
  const other = [...new Set(found.map((f) => f.tree).filter((t) => t !== tree))];
  if (other.length) {
    return [{ file: ONLINE_TABLE, refused: `the run measured tree ${other.join(", ")}, not this checkout's ${tree}: merge main, then rerun` }];
  }
  const captures = found.flatMap(({ at }) =>
    VIEWPORTS.map((vp) => captureName(vp.name))
      .filter((name) => readdirSync(at).includes(name))
      .map((name): Output => ({ file: `${CAPTURES}/${name}`, next: readFileSync(path.join(at, name)) }))
  );
  return [{ file: ONLINE_TABLE, next: mergedRecord(record, found.flatMap((f) => f.rows)) }, ...captures];
}

function fromRun(runId: string): Output[] {
  const dir = mkdtempSync(path.join(tmpdir(), "regen-"));
  try {
    execFileSync("gh", ["run", "download", runId, "--pattern", `${RESULTS_ARTIFACT.prefix}*`, "--dir", dir], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
    return fromMeasured(dir, tree, read(ONLINE_TABLE)).map((out) => ("refused" in out ? { ...out, refused: `run ${runId}: ${out.refused}` } : out));
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
    return [{ file: ONLINE_TABLE, refused: `run ${runId} could not be read: ${stderr || (e as Error).message}` }];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv: string[]): number {
  const at = argv.indexOf("--from-run");
  const runId = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && !/^\d+$/.test(runId ?? "")) throw new Error("usage: npm run regen [-- --from-run <run id>]");
  let refused = 0;
  for (const out of [...outputs(), ...(runId ? fromRun(runId) : [])]) {
    if ("refused" in out) {
      refused++;
      process.stdout.write(`refused  ${out.file}: ${out.refused}\n`);
      continue;
    }
    const file = path.join(root, out.file);
    let was: Buffer | undefined;
    try {
      was = readFileSync(file);
    } catch {
      was = undefined;
    }
    if (was?.equals(Buffer.from(out.next))) {
      process.stdout.write(`current  ${out.file}\n`);
    } else {
      writeFileSync(file, out.next);
      process.stdout.write(`wrote    ${out.file}\n`);
    }
    if (out.dropped?.length) process.stdout.write(`         dropped ${out.dropped.join(", ")}: only this branch recorded them\n`);
  }
  return refused ? 1 : 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = main(process.argv.slice(2));
