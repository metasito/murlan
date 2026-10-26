/**
 * What ci.yml's `verify` shards print and `Node tests complete` reads: the files each shard ran,
 * judged together against the test files on disk, since no shard can see the others'.
 */
import { globSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const SHARD_LINE = "test shard: ";
export const RAN_LINE = "test file ran: ";
export const IDLE_LINE = "test file loaded without running a test: ";

/** @param {string[]} execArgv @returns {{ index: number, total: number } | undefined} */
export function shardOf(execArgv) {
  const flag = execArgv.find((a) => a.startsWith("--test-shard="));
  const m = /^--test-shard=(\d+)\/(\d+)$/.exec(flag ?? "");
  return m ? { index: Number(m[1]), total: Number(m[2]) } : undefined;
}

/** @param {string} text */
export function parseShardLog(text) {
  const lines = text.split("\n");
  const after = (prefix) => lines.filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
  return {
    shards: after(SHARD_LINE).map((s) => /^(\d+)\/(\d+)$/.exec(s)).map((m) => (m ? { index: Number(m[1]), total: Number(m[2]) } : undefined)),
    ran: after(RAN_LINE),
    idle: after(IDLE_LINE),
  };
}

/** The glob is the last argument of package.json's `test` script, so the two cannot name different files. */
export function testFilesOnDisk(testScript, cwd = process.cwd()) {
  const glob = testScript.trim().split(/\s+/).at(-1).replace(/^"|"$/g, "");
  return globSync(glob, { cwd }).map((f) => f.split("\\").join("/")).sort();
}

const INTEGRATION_FLOOR = 40;
const RESTORE_TEST = "tests/server/backupDb.test.ts";

/**
 * @param {string[]} logs one per shard
 * @param {string[]} onDisk every test file the `test` script's glob matches
 * @returns {string[]} what is wrong; empty when the shards together ran every file exactly once
 */
export function judge(logs, onDisk) {
  const parsed = logs.map(parseShardLog);
  const problems = [];
  const own = parsed.map((p) => (p.shards.length === 1 ? p.shards[0] : undefined));
  if (own.length === 0 || own.some((s) => !s)) return ["a shard's log does not name its shard exactly once — it did not run as a shard"];
  const total = own[0].total;
  const indices = own.map((s) => s.index).sort((a, b) => a - b);
  if (own.some((s) => s.total !== total) || indices.join() !== Array.from({ length: total }, (_, i) => i + 1).join()) {
    problems.push(`the logs are shards ${own.map((s) => `${s.index}/${s.total}`).join(", ")}, not 1..${total} of one split`);
  }
  const seen = new Map();
  for (const [i, p] of parsed.entries()) {
    for (const f of [...p.ran, ...p.idle]) {
      if (seen.has(f)) problems.push(`${f} loaded in shards ${seen.get(f)} and ${own[i].index} — --test-shard did not split the run`);
      seen.set(f, own[i].index);
    }
  }
  const disk = new Set(onDisk);
  for (const f of disk) if (!seen.has(f)) problems.push(`test file never loaded by any shard: ${f}`);
  for (const f of seen.keys()) if (!disk.has(f)) problems.push(`a shard loaded ${f}, which the test glob does not match`);

  const ran = new Set(parsed.flatMap((p) => p.ran));
  const integration = onDisk.filter((f) => /^tests\/integration\/[^/]+\.test\.ts$/.test(f));
  if (integration.length < INTEGRATION_FLOOR) {
    problems.push(`only ${integration.length} integration files found on disk — the suite moved, and this count no longer sees it`);
  }
  for (const f of integration.filter((f) => !ran.has(f))) problems.push(`integration file loaded but ran no test (skipped?): ${f}`);
  if (!ran.has(RESTORE_TEST)) problems.push(`${RESTORE_TEST} ran no test — the backup restore was not proven`);
  return problems;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [pkg, ...logs] = process.argv.slice(2);
  const { readFileSync } = await import("node:fs");
  const problems = judge(
    logs.map((f) => readFileSync(f, "utf8")),
    testFilesOnDisk(JSON.parse(readFileSync(pkg, "utf8")).scripts.test)
  );
  for (const p of problems) console.log(`::error::${p}`);
  if (problems.length === 0) console.log(`${logs.length} shards ran every test file exactly once.`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
