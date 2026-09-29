// tests/server/pgConnections.test.ts — every Postgres connection the server opens goes through
// server/store/pool.ts, which is what gives each client an `error` listener.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FACTORY = "server/store/pool.ts";
const PG = String.raw`["']pg(?:-pool)?["']`;
const CONNECTION = new RegExp(
  [
    String.raw`\bnew\s+(?:pg\.)?(?:Pool|Client)\s*\(`,
    String.raw`\b(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*${PG}`,
    String.raw`\b(?:import|require)\s*\(\s*${PG}`,
    String.raw`\bdrizzle\s*\(\s*(?:["'\x60{]|process\b)`,
    String.raw`\b(?:connectionString|conString|DATABASE_URL)\b`,
  ].join("|"),
  "g"
);
const READS_URL: Record<string, { reads: number; why: string }> = {
  "server/http/bootEnv.ts": { reads: 3, why: "checks the variable at boot, and names it in two messages" },
  "server/socket/socketAdapter.ts": { reads: 2, why: "hands it to channelPrefix and listenPattern, which return strings" },
};

function connectionSites(sources: [string, string][]): string[] {
  return scanSources(CONNECTION, sources.map(([file, src]): [string, string] => [file, blankComments(src)]));
}

test("only server/store/pool.ts opens a Postgres connection or reads the URL to open one", () => {
  const sites = connectionSites(sourcesUnder(repoRoot, ["server"], /\.[cm]?[jt]sx?$/));
  assert.ok(sites.some((s) => s.startsWith(`${FACTORY}:`)), `nothing found in ${FACTORY}: the scan reads nothing`);
  const allowed = Object.entries(READS_URL).flatMap(([file, { reads }]) =>
    Array.from({ length: reads }, () => `${file}: DATABASE_URL`)
  );
  assert.deepEqual(sites.filter((s) => !s.startsWith(`${FACTORY}:`)), allowed.sort());
});

test("the scan sees every way a connection is written, and not a type import or a comment", () => {
  const planted: [string, string][] = [
    ["a.ts", "const p = new Pool({});"],
    ["b.ts", "const p = new pg.Pool({});"],
    ["c.ts", "const c = new Client({});"],
    ["d.ts", 'import { Pool as P } from "pg";'],
    ["e.ts", 'import pg from "pg";'],
    ["f.ts", 'export { Pool } from "pg";'],
    ["g.ts", 'const { Pool } = await import("pg");'],
    ["h.ts", 'const pg = require("pg");'],
    ["i.ts", 'import Pool from "pg-pool";'],
    ["j.ts", "export const db = drizzle(process.env.DATABASE_URL);"],
    ["k.ts", "export const db = drizzle({ connection: url });"],
    ["l.ts", "const store = new PgStore({ conString: url });"],
    [
      "m.ts",
      'import type { Pool } from "pg";\n// new Pool({})\nimport x from "connect-pg-simple";\nconst db = drizzle(pool, { schema });',
    ],
  ];
  assert.deepEqual(
    [...new Set(connectionSites(planted).map((s) => s.split(":")[0]))],
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((f) => `${f}.ts`)
  );
});
