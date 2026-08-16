// tests/dbPush.test.ts — the session table must survive `npm run db:push`.
//
// `session` is owned by connect-pg-simple and pre-created, so it is
// deliberately not in shared/schema.ts. That leaves drizzle-kit looking at a
// table it does not know about: on any push that also *adds* a table, it asks
// whether the new one is a rename of `session`. Answering yes renames the
// session table and logs out every account, and there is no undo.
//
// The invariant is only real if it does not depend on whoever reads that
// prompt, so this pins the config that removes the question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

test("drizzle-kit is told to leave the session table alone", () => {
  const config = read("drizzle.config.ts");
  assert.match(
    config,
    /tablesFilter\s*:\s*\[[^\]]*"!session"/,
    "drizzle.config.ts must exclude `session`, or a push can offer to rename it"
  );
});

// The other way to break it: describing `session` in the schema would make
// drizzle-kit own it, and a later shape change would drop and recreate it.
test("the schema does not describe the session table", () => {
  const schema = read("shared/schema.ts");
  assert.doesNotMatch(
    schema,
    /pgTable\(\s*"session"/,
    "`session` is pre-created and owned by connect-pg-simple; describing it here hands drizzle-kit the right to recreate it"
  );
});

test("the session store is still told not to create the table itself", () => {
  assert.match(
    read("server/session.ts"),
    /createTableIfMissing\s*:\s*false/,
    "createTableIfMissing must stay false — see replit.md"
  );
});
