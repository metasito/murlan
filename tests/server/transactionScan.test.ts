// tests/server/transactionScan.test.ts — every transaction in the server goes through
// server/store/pool.ts's inTransaction, which owns its client from connect to release.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { blankComments, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const WRAPPER = "server/store/pool.ts";
const OPENS_TRANSACTION = /\.transaction\s*\(|["'`]\s*(?:BEGIN|START\s+TRANSACTION)\b/gi;

function transactionSites(sources: [string, string][]): string[] {
  return scanSources(OPENS_TRANSACTION, sources.map(([f, src]): [string, string] => [f, blankComments(src)]));
}

test("no transaction in the server opens outside inTransaction", () => {
  const sites = transactionSites(sourcesUnder(repoRoot, ["server"], /\.[cm]?[jt]sx?$/));
  assert.deepEqual(
    sites.filter((s) => s.startsWith(`${WRAPPER}:`)),
    [`${WRAPPER}: "BEGIN`],
    `the scan did not find ${WRAPPER}'s own BEGIN, so it reads nothing`
  );
  assert.deepEqual(sites.filter((s) => !s.startsWith(`${WRAPPER}:`)), []);
});

test("the transaction scan sees drizzle's transaction and a hand-written BEGIN, and not a DO block or a comment", () => {
  const planted: [string, string][] = [
    ["a.ts", "await db().transaction(async (tx) => {});"],
    ["b.ts", "await db()\n  .transaction((tx) => run(tx));"],
    ["c.ts", 'await client.query("BEGIN");'],
    ["d.ts", "await tx.execute(sql`begin isolation level serializable`);"],
    ["e.ts", "await client.query(' start transaction');"],
    ["f.ts", '"DO $$ BEGIN\\n  CREATE TYPE x;\\nEND $$;"\n// db().transaction(\nawait transaction(async (tx) => {});'],
  ];
  assert.deepEqual(
    [...new Set(transactionSites(planted).map((s) => s.split(":")[0]))],
    ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]
  );
});
