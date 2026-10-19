// The floor under the e2e knobs (CLAUDE.md, "No self-defeating safeguards"): a stored key is the
// trigger, the build flag is what a stray key cannot get past, and one module reads that flag.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { e2eFast, storedFlag } from "../../lib/e2eConfig.ts";
import { E2E_REAL_EXCHANGE_KEY, E2E_SUSPEND_BOT_KEY } from "../../lib/storageKeys.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OWNER = path.join("lib", "e2eConfig.ts");
const FLAG = "EXPO_PUBLIC_E2E_FAST";

type WithStorage = { localStorage?: unknown };
const stubStorage = (getItem: (key: string) => string | null) => {
  (globalThis as WithStorage).localStorage = { getItem };
};
const built = (on: boolean) => {
  if (on) process.env[FLAG] = "1";
  else delete process.env[FLAG];
};

afterEach(() => {
  delete (globalThis as WithStorage).localStorage;
  built(false);
});

describe("storedFlag", () => {
  test("an e2e build reads the key the harness wrote", () => {
    built(true);
    stubStorage((key) => (key === E2E_SUSPEND_BOT_KEY ? "1" : null));
    assert.equal(e2eFast(), true);
    assert.equal(storedFlag(E2E_SUSPEND_BOT_KEY), true);
    assert.equal(storedFlag(E2E_REAL_EXCHANGE_KEY), false);
  });

  test("dev and production never reach the store, whatever it holds", () => {
    let reads = 0;
    stubStorage(() => {
      reads += 1;
      return "1";
    });
    assert.equal(storedFlag(E2E_SUSPEND_BOT_KEY), false);
    assert.equal(storedFlag(E2E_REAL_EXCHANGE_KEY), false);
    assert.equal(reads, 0, "the build gate must short-circuit before the store is read");
  });

  test("an e2e build with no key written, and a platform with no store, play on", () => {
    built(true);
    stubStorage(() => null);
    assert.equal(storedFlag(E2E_SUSPEND_BOT_KEY), false);
    delete (globalThis as WithStorage).localStorage;
    assert.equal(storedFlag(E2E_SUSPEND_BOT_KEY), false);
  });

  test("a browser that blocks site data plays on rather than throwing", () => {
    built(true);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    assert.equal(storedFlag(E2E_SUSPEND_BOT_KEY), false);
  });
});

test("the knobs read the keys the harness writes, once, as the bundle evaluates", async () => {
  built(true);
  stubStorage((key) => (key === E2E_REAL_EXCHANGE_KEY ? "1" : null));
  const fresh = "../../lib/e2eConfig.ts?knobs";
  const { e2e } = (await import(fresh)) as typeof import("../../lib/e2eConfig.ts");
  assert.deepEqual(e2e, { suspendBot: false, realExchange: true });
});

test(`${FLAG} is read in exactly one source file, ${OWNER}`, () => {
  const readers = trackedFiles(ROOT, "app", "components", "context", "lib", "shared", "modules", "locales", "server")
    .filter((f) => /\.(?:[cm]?[jt]sx?)$/.test(f))
    .filter((f) => readFileSync(path.join(ROOT, f), "utf8").includes(FLAG));
  assert.deepEqual(readers.map((f) => path.normalize(f)), [OWNER]);
});
