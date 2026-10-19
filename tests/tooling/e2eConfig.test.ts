// The floor under the e2e knobs (CLAUDE.md, "No self-defeating safeguards"): a stored key is the
// trigger, the build flag is what a stray key cannot get past, and one module reads that flag.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { E2E_REAL_EXCHANGE_KEY, E2E_SUSPEND_BOT_KEY } from "../../lib/storageKeys.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OWNER = path.join("lib", "e2eConfig.ts");
const FLAG = "EXPO_PUBLIC_E2E_FAST";

type WithStorage = { localStorage?: unknown };
const stubStorage = (getItem: (key: string) => string | null) => {
  (globalThis as WithStorage).localStorage = { getItem };
};

let builds = 0;
/** The module as a bundle built with or without the flag evaluates it: the flag is read once, at load. */
async function built(on: boolean): Promise<typeof import("../../lib/e2eConfig.ts")> {
  if (on) process.env[FLAG] = "1";
  else delete process.env[FLAG];
  const fresh = `../../lib/e2eConfig.ts?build=${builds++}`;
  return import(fresh);
}

afterEach(() => {
  delete (globalThis as WithStorage).localStorage;
  delete process.env[FLAG];
});

describe("storedFlag", () => {
  test("an e2e build reads the key the harness wrote", async () => {
    const config = await built(true);
    stubStorage((key) => (key === E2E_SUSPEND_BOT_KEY ? "1" : null));
    assert.equal(config.E2E_FAST, true);
    assert.equal(config.storedFlag(E2E_SUSPEND_BOT_KEY), true);
    assert.equal(config.storedFlag(E2E_REAL_EXCHANGE_KEY), false);
  });

  test("dev and production never reach the store, whatever it holds", async () => {
    let reads = 0;
    stubStorage(() => {
      reads += 1;
      return "1";
    });
    const config = await built(false);
    assert.equal(config.storedFlag(E2E_SUSPEND_BOT_KEY), false);
    assert.equal(config.storedFlag(E2E_REAL_EXCHANGE_KEY), false);
    assert.deepEqual(config.e2e, { suspendBot: false, realExchange: false });
    assert.equal(reads, 0, "the build gate must short-circuit before the store is read");
  });

  test("an e2e build with no key written, and a platform with no store, play on", async () => {
    const config = await built(true);
    stubStorage(() => null);
    assert.equal(config.storedFlag(E2E_SUSPEND_BOT_KEY), false);
    delete (globalThis as WithStorage).localStorage;
    assert.equal(config.storedFlag(E2E_SUSPEND_BOT_KEY), false);
  });

  test("a browser that blocks site data plays on rather than throwing", async () => {
    const config = await built(true);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    assert.equal(config.storedFlag(E2E_SUSPEND_BOT_KEY), false);
  });
});

test("the knobs read the keys the harness writes, once, as the bundle evaluates", async () => {
  stubStorage((key) => (key === E2E_REAL_EXCHANGE_KEY ? "1" : null));
  const { e2e } = await built(true);
  assert.deepEqual(e2e, { suspendBot: false, realExchange: true });
});

describe("the platform-shaped knobs", () => {
  test("a player's build holds no exchange and reads no launch argument", async () => {
    const config = await built(false);
    let reads = 0;
    assert.equal(config.opener("ios", () => (reads++, "1")), false);
    assert.equal(reads, 0, "the build gate must short-circuit before the launch argument is read");
    for (const os of ["web", "ios", "android"]) assert.equal(config.exchangeHold(os), undefined);
  });

  test("an e2e build holds the overlay on a timer on web and until tapped on a device, unless a spec opted out", async () => {
    const held = await built(true);
    assert.equal(typeof held.exchangeHold("web"), "number");
    assert.equal(held.exchangeHold("ios"), "untilTapped");
    assert.equal(held.exchangeHold("android"), "untilTapped");
    stubStorage((key) => (key === E2E_REAL_EXCHANGE_KEY ? "1" : null));
    assert.equal((await built(true)).exchangeHold("web"), undefined);
  });

  test("only iOS has the opener's launch argument", async () => {
    const config = await built(true);
    assert.equal(config.opener("ios", () => "1"), true);
    assert.equal(config.opener("ios", () => null), false);
    assert.equal(config.opener("android", () => "1"), false);
  });
});

test(`${FLAG} is read in exactly one source file, ${OWNER}`, () => {
  const readers = trackedFiles(ROOT, "app", "components", "context", "lib", "shared", "modules", "locales", "server")
    .filter((f) => /\.(?:[cm]?[jt]sx?)$/.test(f))
    .filter((f) => readFileSync(path.join(ROOT, f), "utf8").includes(FLAG));
  assert.deepEqual(readers.map((f) => path.normalize(f)), [OWNER]);
});
