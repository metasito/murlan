// tests/server/retentionOffWritePath.test.ts — #895, #1688: every age-based delete under server/
// is server/game/retention.ts's scheduled sweep, never a DELETE riding a request.
//
// An age-based delete is any function that compares a timestamp column (derived from
// shared/schema.ts) and, in the same function, deletes, purges or prunes — whatever shape
// the comparison takes (`lt`/`lte`/`gt`/`gte`, raw `${col} < …`, raw `expires_at < now()`)
// and whether the delete is a builder call, raw SQL or a store method fed the selected ids.
//
// Scoped to the function rather than the file: server/store/activeGameStore.ts counts
// untouched rows in one method and deletes a row by key in another, and neither is an
// age-based delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");
const RETENTION = path.join("game", "retention.ts");

function serverSources(): { file: string; source: string }[] {
  return readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((file) => ({ file, source: readFileSync(path.join(SERVER_DIR, file), "utf8") }));
}

const TIMESTAMP_COLUMNS = [
  ...readFileSync(path.join(REPO_ROOT, "shared", "schema.ts"), "utf8").matchAll(/(\w+):\s*timestamp\(\s*"(\w+)"/g),
];
const CAMEL = [...new Set(TIMESTAMP_COLUMNS.map((m) => m[1]))].join("|");
const SNAKE = [...new Set(TIMESTAMP_COLUMNS.map((m) => m[2]))].join("|");

const AGE_COMPARISONS = [
  new RegExp(String.raw`\b(?:lt|lte|gt|gte)\(\s*[\w.]*\.(?:${CAMEL})\b`),
  new RegExp(String.raw`\$\{\s*[\w.]*\.(?:${CAMEL})\s*\}\s*[<>]=?`),
  new RegExp(String.raw`\b(?:${SNAKE})"?\s*[<>]=?`),
];
const REMOVES = /\bdelete\w*\s*\(|DELETE\s+FROM|\bpurge\w*\s*\(|\bprune\w*\s*\(/i;

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** A top-level function, an exported arrow, or an object method at two spaces. */
const FUNCTION_START =
  /^(?=(?:export )?(?:async )?function\b|export const \w+ = (?:async )?\(|  async \w+\s*\(|  \w+\([^\n]*\)\s*(?::[^\n]*)?\{\s*$)/m;

function ageBasedDeletes(source: string): string[] {
  return code(source)
    .split(FUNCTION_START)
    .filter((fn) => REMOVES.test(fn) && AGE_COMPARISONS.some((age) => age.test(fn)));
}

const hasAgeBasedPrune = (source: string) => ageBasedDeletes(source).length > 0;

test("the timestamp columns are read from the schema", () => {
  assert.match(CAMEL, /\bexpiresAt\b/);
  assert.match(SNAKE, /\bcreated_at\b/);
});

test("no server module prunes an aged row inside the write that just grew the table", () => {
  const offenders = serverSources()
    .filter(({ source }) => /\.insert\(/.test(source) && hasAgeBasedPrune(source))
    .map(({ file }) => file);

  assert.deepEqual(
    offenders,
    [],
    "an age-based prune belongs to server/game/retention.ts's scheduled sweep, " +
      "not the write path — this shape once justified itself in " +
      "server/shared/events.ts, server/http/clientErrors.ts, server/game/replays.ts and " +
      "server/http/bugReports.ts by citing each other as precedent. Offending " +
      "module(s): " +
      offenders.join(", ")
  );
});

test("the signature sees each shape an age-based prune has taken", () => {
  const shapes: [string, string][] = [
    [
      "a builder delete on the server clock",
      `export async function redeem() {
  await db.delete(socketTicketNonces).where(lt(socketTicketNonces.expiresAt, new Date(now())));
}`,
    ],
    [
      "a builder delete on a Postgres interval",
      `export async function record() {
  await db.delete(events).where(lt(events.occurredAt, sql\`now() - make_interval(days => \${n})\`));
}`,
    ],
    [
      "raw SQL on Postgres' clock",
      "export async function mint() {\n  await db.execute(sql`DELETE FROM auth_tokens WHERE expires_at < now()`);\n}",
    ],
    [
      "a cutoff held in a variable, with lte",
      `export async function sweep() {
  const cutoff = new Date(now() - DAY);
  await db.delete(bugReports).where(lte(bugReports.createdAt, cutoff));
}`,
    ],
    [
      "raw SQL comparing an interpolated column",
      "export async function sweep() {\n  await db.execute(sql`DELETE FROM ${events} WHERE ${events.occurredAt} < ${cutoff}`);\n}",
    ],
    [
      "aged ids selected, then handed to a store's purge",
      `export async function pruneStaleRooms(): Promise<number> {
  const cutoff = new Date(now() - STALE_ROOM_MAX_AGE_MS);
  const candidates = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(lt(roomsTable.createdAt, cutoff))
    .limit(STALE_ROOM_BATCH);

  const ids = candidates.map((r) => r.id).filter((id) => !activeGames.has(id));
  const gone = await roomStore.purgeRooms(db, ids);
  if (gone > 0) logger.info({ count: gone }, "Pruned rooms nobody can still be playing in");
  return gone;
}`,
    ],
    [
      "a store method keeping only fresh rows",
      `export const store = {
  async sweep(cutoff: Date) {
    await db.delete(sessions).where(gt(sessions.lastSeen, cutoff));
  },
};`,
    ],
  ];
  for (const [what, shape] of shapes) {
    assert.ok(hasAgeBasedPrune(shape), what);
  }
});

test("a key delete beside an age count, in separate functions, is not an age-based delete", () => {
  const source = `export const store = {
  async drop(roomId: string) {
    await db.delete(activeGames).where(eq(activeGames.roomId, roomId));
  },

  async countUntouchedSince(cutoff: Date) {
    return db.select({ n: count() }).from(activeGames).where(lt(activeGames.updatedAt, cutoff));
  },
};`;
  assert.equal(hasAgeBasedPrune(source), false);
});

test("every age-based delete under server/ lives in server/game/retention.ts", () => {
  const sources = serverSources();
  const home = sources.find(({ file }) => file === RETENTION);
  assert.ok(home && hasAgeBasedPrune(home.source), "retention.ts no longer reads as the home of the sweep");

  const offenders = sources
    .filter(({ file, source }) => file !== RETENTION && hasAgeBasedPrune(source))
    .map(({ file }) => file);
  assert.deepEqual(offenders, [], "move the age-based delete into retention.ts's sweep: " + offenders.join(", "));
});
