// tests/exchangeE2EHold.test.ts — #915: only a Maestro-built offline table may
// hold the exchange overlay open past its real duration, and only when
// `EXPO_PUBLIC_E2E_FAST` is set. The forwarding chain's own behaviour is
// proven by `tests/native/exchangeE2EHold.test.tsx`; what is left here is what
// that test cannot see — which builds set the flag at all, and which provider
// is allowed to turn it into an override — read off the source the way
// `tests/reducedMotion.test.ts` reads its own automation flag.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const gameContext = read("context/GameContext.tsx");
const onlineGameContext = read("context/OnlineGameContext.tsx");
const gameHooks = read("context/gameHooks.ts");
const offlineScreen = read("app/game.tsx");

/**
 * The arguments of the first call to `name(` in `source`, respecting nested
 * `()`/`[]`/`{}` — a plain regex up to the first `)` reads
 * `f(x, y)` as ending after `f(x`, and misses the real second argument.
 */
function callArgs(source: string, name: string): string {
  const at = source.indexOf(`${name}(`);
  assert.ok(at >= 0, `${name} is never called`);
  let i = at + name.length + 1;
  let depth = 1;
  const start = i;
  for (; depth > 0; i++) {
    if ("([{".includes(source[i])) depth++;
    else if (")]}".includes(source[i])) depth--;
  }
  return source.slice(start, i - 1);
}

function hasTopLevelComma(args: string): boolean {
  let depth = 0;
  for (const ch of args) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

describe("the offline exchange overlay's E2E hold", () => {
  test("only the E2E harness's own build configs ever set EXPO_PUBLIC_E2E_FAST", () => {
    // A plain assignment (`= "1"` / `: "1"`), never a read: `app/game.tsx` and
    // `context/GameContext.tsx` compare against it with `===`, which this flag
    // does not match, so a reader gating its own behaviour is not a setter.
    const FLAG = /EXPO_PUBLIC_E2E_FAST\s*[:=]\s*["']1["']/;
    const workflows = readdirSync(path.join(repoRoot, ".github/workflows")).map(
      (name) => `.github/workflows/${name}`
    );
    const scripts = readdirSync(path.join(repoRoot, "scripts"), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => `scripts/${e.name}`);
    const roots = readdirSync(repoRoot, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    const setters = [...workflows, ...scripts, ...roots].filter((rel) => FLAG.test(read(rel)));

    assert.deepEqual(
      setters,
      [".github/workflows/ios.yml", ".github/workflows/maestro.yml", "scripts/e2e-server.mjs"],
      `EXPO_PUBLIC_E2E_FAST zeroes every AI/result delay app/game.tsx has, not only the ` +
        `exchange hold — setting it anywhere a player's build is made ships that: ${setters.join(", ")}`
    );
  });

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

  test("the override reaches the offline screen's own exchangeAnnouncement slot", () => {
    assert.match(
      gameHooks,
      /exchangeHoldMsOverride/,
      "useLocalExchange no longer forwards exchangeHoldMsOverride out of GameContext"
    );
    assert.match(
      offlineScreen,
      /holdMsOverride:\s*exchangeHoldMsOverride/,
      "app/game.tsx no longer passes exchangeHoldMsOverride into the exchangeAnnouncement slot " +
        "it hands to GameTable"
    );
  });

  test("OnlineGameContext never passes a hold override into useExchangeAnnouncement", () => {
    const args = callArgs(onlineGameContext, "useExchangeAnnouncement");
    assert.equal(
      hasTopLevelComma(args),
      false,
      "the online table now passes a second argument to useExchangeAnnouncement — " +
        "its clock must stay exchangeAnnounceMs() exactly, or the client's overlay " +
        "and the server's hold (server/tableHandlers.ts, server/onlineGameLogic.ts) drift apart"
    );
  });
});
