// The floor under the suspend knob (CLAUDE.md, "No self-defeating safeguards"):
// the flag is the trigger, the build gate is what a stray flag cannot get past.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { suspendAI, E2E_SUSPEND_AI_KEY } from "../lib/e2eAiSuspend.ts";

type WithStorage = { localStorage?: unknown };

function stubStorage(getItem: (key: string) => string | null) {
  (globalThis as WithStorage).localStorage = { getItem };
}

afterEach(() => {
  delete (globalThis as WithStorage).localStorage;
});

describe("suspendAI", () => {
  test("holds the seat when the e2e build wrote the flag", () => {
    stubStorage((key) => (key === E2E_SUSPEND_AI_KEY ? "1" : null));
    assert.equal(suspendAI(true), true);
  });

  test("dev and production never reach the flag, whatever it holds", () => {
    let reads = 0;
    stubStorage(() => {
      reads += 1;
      return "1";
    });
    assert.equal(suspendAI(false), false);
    assert.equal(reads, 0, "the build gate must short-circuit before the flag is read");
  });

  test("an e2e build with no flag written, and a platform with no store, play on", () => {
    stubStorage(() => null);
    assert.equal(suspendAI(true), false);
    delete (globalThis as WithStorage).localStorage;
    assert.equal(suspendAI(true), false);
  });

  test("a browser that blocks site data plays on rather than throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    assert.equal(suspendAI(true), false);
  });
});
