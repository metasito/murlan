// tests/engine/sharedGameFlowScan.test.ts — the source scan split out of sharedGameFlow.test.ts so the mutation run keeps that file's behaviour tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The point of the shared form: a change to the ceremony is one change.
 * Source-read, because what is being pinned is that the providers do not hold
 * their own — which is a property of the files, not of a render.
 */
test("neither provider keeps its own ceremony", () => {
  const root = new URL("../..", import.meta.url);
  for (const file of ["context/GameContext.tsx", "context/OnlineGameContext.tsx"]) {
    const source = readFileSync(new URL(file, root), "utf8");
    assert.ok(
      source.includes("useExchangeAnnouncement("),
      `${file} does not drive the ceremony from context/useExchangeAnnouncement.ts`
    );
    assert.equal(
      /useState[^\n]*\bexchangeAnnounc|setExchangeAnnouncing/i.test(source),
      false,
      `${file} holds the announcement again; the clock that ends it is now in two places`
    );
  }
});
