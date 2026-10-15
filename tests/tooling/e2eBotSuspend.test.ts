// The floor under the suspend knob (CLAUDE.md, "No self-defeating safeguards"):
// the flag is the trigger, the build gate is what a stray flag cannot get past.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { suspendBot, E2E_SUSPEND_BOT_KEY } from "../../lib/e2eBotSuspend.ts";

type WithStorage = { localStorage?: unknown };

function stubStorage(getItem: (key: string) => string | null) {
  (globalThis as WithStorage).localStorage = { getItem };
}

afterEach(() => {
  delete (globalThis as WithStorage).localStorage;
});

describe("suspendBot", () => {
  test("holds the seat when the e2e build wrote the flag", () => {
    stubStorage((key) => (key === E2E_SUSPEND_BOT_KEY ? "1" : null));
    assert.equal(suspendBot(true), true);
  });

  test("dev and production never reach the flag, whatever it holds", () => {
    let reads = 0;
    stubStorage(() => {
      reads += 1;
      return "1";
    });
    assert.equal(suspendBot(false), false);
    assert.equal(reads, 0, "the build gate must short-circuit before the flag is read");
  });

  test("an e2e build with no flag written, and a platform with no store, play on", () => {
    stubStorage(() => null);
    assert.equal(suspendBot(true), false);
    delete (globalThis as WithStorage).localStorage;
    assert.equal(suspendBot(true), false);
  });

  test("a browser that blocks site data plays on rather than throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    assert.equal(suspendBot(true), false);
  });
});
