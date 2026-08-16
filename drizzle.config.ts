import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // `session` is owned by connect-pg-simple, pre-created, and must never be
  // dropped or recreated (CLAUDE.md, replit.md). It is deliberately absent from
  // shared/schema.ts — which means drizzle-kit sees a table it does not know
  // about, and on any push that also adds a table it asks whether the new one
  // is a *rename* of `session`. Answering that wrongly renames the session
  // table and logs out every account. Excluding it here makes push
  // non-interactive and structurally unable to touch it, rather than leaving
  // the invariant to whoever is reading the prompt.
  tablesFilter: ["!session"],
});
