// The floor under the real-exchange knob (CLAUDE.md, "No self-defeating safeguards"):
// the flag is the trigger, the build gate is what a stray flag cannot get past.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { realExchange, E2E_REAL_EXCHANGE_KEY } from "../../lib/e2eRealExchange.ts";

type WithStorage = { localStorage?: unknown };

function stubStorage(getItem: (key: string) => string | null) {
  (globalThis as WithStorage).localStorage = { getItem };
}

afterEach(() => {
  delete (globalThis as WithStorage).localStorage;
});

describe("realExchange", () => {
  test("drops the hold override when the e2e build wrote the flag", () => {
    stubStorage((key) => (key === E2E_REAL_EXCHANGE_KEY ? "1" : null));
    assert.equal(realExchange(true), true);
  });

  test("dev and production never reach the flag, whatever it holds", () => {
    let reads = 0;
    stubStorage(() => {
      reads += 1;
      return "1";
    });
    assert.equal(realExchange(false), false);
    assert.equal(reads, 0, "the build gate must short-circuit before the flag is read");
  });

  test("an e2e build with no flag written, and a platform with no store, keep the override", () => {
    stubStorage(() => null);
    assert.equal(realExchange(true), false);
    delete (globalThis as WithStorage).localStorage;
    assert.equal(realExchange(true), false);
  });

  test("a browser that blocks site data keeps the override rather than throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    assert.equal(realExchange(true), false);
  });
});
