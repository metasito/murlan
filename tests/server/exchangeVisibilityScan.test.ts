// tests/server/exchangeVisibilityScan.test.ts — the source scan split out of exchangeVisibility.test.ts so the mutation run keeps that file's behaviour tests
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("markExchangeSettled", () => {
  /**
   * The two halves above are each sound on their own, and both stay green if
   * nothing ever calls the writer: the sanitizer would then see an unstamped
   * phase forever and no seat but the two trading would ever be shown the card
   * (docs/agents/RULES.md rule 6).
   *
   * Read off the source because `server/game/gamePersistence.ts` builds a pg pool at
   * import — the reason these helpers live in `onlineGameLogic.ts` at all.
   */
  test("the broadcast is what stamps it, before it serves any seat", () => {
    const source = readFileSync(
      new URL("../../server/game/gamePersistence.ts", import.meta.url),
      "utf8"
    );
    const body = source.slice(source.indexOf("export function publishState"));
    const stamp = body.indexOf("markExchangeSettled(");
    const firstSend = body.indexOf("sendGameStateTo(");
    assert.ok(stamp >= 0, "publishState no longer stamps the settle time");
    assert.ok(
      firstSend >= 0 && stamp < firstSend,
      "a seat is served before the settle is stamped, so it is told nothing"
    );
  });
});
