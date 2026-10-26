import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Two servers in one process each read their own env when they boot; a read
 * made while a module loads is settled by whoever imported it first.
 * `NODE_ENV` and `LOG_PRETTY` in `createLogger` are the settings left: they pick
 * pino's level and transport, fixed when the instance every module imports is
 * built. Named by line, so another read, even of the same variable, fails.
 */
const KNOWN = ["LOG_PRETTY @ server/shared/logger.ts:70", "NODE_ENV @ server/shared/logger.ts:73", "NODE_ENV @ server/shared/logger.ts:81"];

const reads = new Set<string>();
const env = process.env;
// The frame right above the trap is the reader: a child process spawned at
// import copies the whole env from inside node:child_process, which reads no setting.
process.env = new Proxy(env, {
  get(target, key, receiver) {
    const caller = new Error().stack?.split("\n")[2] ?? "";
    const [, file, line] = caller.match(/file:\/\/(\/[^:]+):(\d+):\d+/) ?? [];
    if (file?.startsWith(repoRoot) && !file.includes("node_modules")) {
      reads.add(`${String(key)} @ ${path.relative(repoRoot, file).split(path.sep).join("/")}:${line}`);
    }
    return Reflect.get(target, key, receiver);
  },
});

const MODULES = readdirSync(path.join(repoRoot, "server"), { recursive: true, encoding: "utf8" })
  .map((f) => f.split(path.sep).join("/"))
  .filter((f) => f.endsWith(".ts") && f !== "index.ts");

test("no server module reads the environment while it loads", async () => {
  void process.env.MURLAN_IMPORT_PROBE;
  assert.ok(
    [...reads].some((r) => r.startsWith("MURLAN_IMPORT_PROBE @ tests/server/noEnvReadAtImport.test.ts:")),
    "the probe did not see a read made in plain sight, so it proves nothing"
  );
  reads.clear();

  assert.ok(MODULES.length >= 80, `only ${MODULES.length} server modules found — the derived list is broken`);
  for (const name of MODULES) await import(`../../server/${name}`);

  assert.deepEqual([...reads].filter((r) => !KNOWN.includes(r)).sort(), [], "read at import, settled by import order");
  assert.deepEqual(
    KNOWN.filter((r) => !reads.has(r)),
    [],
    "a known read is gone: drop it from KNOWN so it cannot come back unseen"
  );
});
