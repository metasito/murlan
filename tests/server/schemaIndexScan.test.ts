// tests/server/schemaIndexScan.test.ts — boot builds every index CONCURRENTLY: a plain
// CREATE INDEX blocks every write to its table for the whole build, on every instance at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { schemaStatements } from "../../server/store/schemaDdl.ts";
import { blankComments, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const PLAIN_INDEX = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY\b)/gi;
const plainIndexes = (sources: [string, string][]) =>
  scanSources(PLAIN_INDEX, sources.map(([f, src]): [string, string] => [f, blankComments(src)]));

test("every index is built concurrently, in the emitted DDL and in the server's source", () => {
  const indexes = schemaStatements().filter((s) => /\bINDEX\b/.test(s));
  assert.ok(indexes.length > 10, `${indexes.length} index statements: the check reads nothing`);
  assert.deepEqual(indexes.filter((s) => !/^CREATE (UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS /.test(s)), []);
  const server = sourcesUnder(repoRoot, ["server"], /\.ts$/);
  assert.ok(server.some(([f, src]) => f === "server/store/schemaDdl.ts" && /INDEX CONCURRENTLY/.test(src)), "the scan did not read schemaDdl.ts");
  assert.deepEqual(plainIndexes(server), [], "a plain CREATE INDEX blocks every write to its table for the whole build");
});

test("the plain-index scan sees a plain or unique CREATE INDEX, and not a concurrent one or a comment", () => {
  assert.deepEqual(
    plainIndexes([
      ["a.ts", 'q("CREATE INDEX IF NOT EXISTS x ON t (c)")'],
      ["b.ts", "const kind = unique ? `create unique index` : 'x';"],
      ["c.ts", '// CREATE INDEX x\nq("CREATE INDEX CONCURRENTLY x ON t (c)")'],
    ]).map((s) => s.split(":")[0]),
    ["a.ts", "b.ts"]
  );
});
