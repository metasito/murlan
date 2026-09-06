// tests/exchangeE2EHold.test.ts — #915: only a Maestro-built offline table may
// hold the exchange overlay open past its real duration, and only when
// `EXPO_PUBLIC_E2E_FAST` is set. Read off the source, the way
// `exchangeVisibility.test.ts`'s `markExchangeSettled` test does: the
// invariant is an absence (no override reaches a real player, no override
// reaches the online path), which a unit test importing the modules live
// cannot see either way.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameContext = readFileSync(new URL("../context/GameContext.tsx", import.meta.url), "utf8");
const onlineGameContext = readFileSync(
  new URL("../context/OnlineGameContext.tsx", import.meta.url),
  "utf8"
);
const sharedGameFlow = readFileSync(new URL("../lib/sharedGameFlow.ts", import.meta.url), "utf8");
const exchangeAnnouncement = readFileSync(
  new URL("../components/ExchangeAnnouncement.tsx", import.meta.url),
  "utf8"
);

describe("the offline exchange overlay's E2E hold", () => {
  test("GameContext only overrides the hold when EXPO_PUBLIC_E2E_FAST is set", () => {
    assert.match(
      gameContext,
      /const E2E_FAST = process\.env\.EXPO_PUBLIC_E2E_FAST === "1";/,
      "GameContext no longer gates on EXPO_PUBLIC_E2E_FAST the same way app/game.tsx does"
    );
    assert.match(
      gameContext,
      /exchangeHoldMsOverride = E2E_FAST \? E2E_EXCHANGE_HOLD_MS : undefined/,
      "the override is no longer undefined when EXPO_PUBLIC_E2E_FAST is unset — " +
        "a real player would get a held-open overlay"
    );
  });

  test("OnlineGameContext never passes a hold override into useExchangeAnnouncement", () => {
    const call = onlineGameContext.match(/useExchangeAnnouncement\(([^)]*)\)/);
    assert.ok(call, "OnlineGameContext no longer calls useExchangeAnnouncement");
    assert.equal(
      call![1].includes(","),
      false,
      "the online table now passes a second argument to useExchangeAnnouncement — " +
        "its clock must stay exchangeAnnounceMs() exactly, or the client's overlay " +
        "and the server's hold (server/tableHandlers.ts, server/onlineGameLogic.ts) drift apart"
    );
  });

  test("the shared expiry clock falls back to exchangeAnnounceMs() with no override", () => {
    assert.match(
      sharedGameFlow,
      /holdMsOverride \?\? exchangeAnnounceMs\(/,
      "useExchangeCeremonyExpiry no longer falls back to the real, shared duration"
    );
  });

  test("the overlay's own dismiss timer falls back to exchangeAnnounceMs() with no override", () => {
    assert.match(
      exchangeAnnouncement,
      /holdMsOverride \?\? exchangeAnnounceMs\(/,
      "ExchangeAnnouncement no longer falls back to the real, shared duration"
    );
  });
});
