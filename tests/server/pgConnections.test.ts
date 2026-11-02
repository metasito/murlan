// tests/server/pgConnections.test.ts — every Postgres connection the server opens goes through
// server/store/pool.ts, and every Redis connection through server/store/redis.ts: each is what
// gives its clients an `error` listener.
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
  "server/store/redis.ts": { reads: 1, why: "derives the Redis keyspace from its search_path, a string" },
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

const REDIS_FACTORY = "server/store/redis.ts";
const REDIS = String.raw`["'](?:redis|@redis/[\w-]+)["']`;
const REDIS_CONNECTION = new RegExp(
  [
    String.raw`\b(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*${REDIS}`,
    String.raw`\b(?:import|require)\s*\(\s*${REDIS}`,
    String.raw`\.duplicate\s*\(`,
    String.raw`\bREDIS_URL\b`,
  ].join("|"),
  "g"
);
const READS_REDIS_URL: Record<string, { reads: number; why: string }> = {
  "server/http/bootEnv.ts": { reads: 1, why: "checks the variable at boot" },
};

function redisSites(sources: [string, string][]): string[] {
  return scanSources(REDIS_CONNECTION, sources.map(([file, src]): [string, string] => [file, blankComments(src)]));
}

test("only server/store/redis.ts opens a Redis connection or reads the URL to open one", () => {
  const sites = redisSites(sourcesUnder(repoRoot, ["server"], /\.[cm]?[jt]sx?$/));
  assert.ok(sites.some((s) => s.startsWith(`${REDIS_FACTORY}:`)), `nothing found in ${REDIS_FACTORY}: the scan reads nothing`);
  const allowed = Object.entries(READS_REDIS_URL).flatMap(([file, { reads }]) =>
    Array.from({ length: reads }, () => `${file}: REDIS_URL`)
  );
  assert.deepEqual(sites.filter((s) => !s.startsWith(`${REDIS_FACTORY}:`)), allowed.sort());
});

test("the Redis scan sees every way a connection is written, and not a type import or a comment", () => {
  const planted: [string, string][] = [
    ["a.ts", 'import { createClient } from "redis";'],
    ["b.ts", 'import { createClient } from "@redis/client";'],
    ["c.ts", 'const { createClient } = await import("redis");'],
    ["d.ts", 'const redis = require("redis");'],
    ["e.ts", "const sub = client.duplicate();"],
    ["f.ts", "const url = process.env.REDIS_URL;"],
    ["g.ts", 'export { createClient } from "redis";'],
    ["h.ts", 'import type { RedisClientType } from "redis";\n// createClient() from "redis"\nimport x from "@socket.io/redis-streams-adapter";'],
  ];
  assert.deepEqual(
    [...new Set(redisSites(planted).map((s) => s.split(":")[0]))],
    ["a", "b", "c", "d", "e", "f", "g"].map((f) => `${f}.ts`)
  );
});
