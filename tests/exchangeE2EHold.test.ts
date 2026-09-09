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
const exchangePhaseFlow = read(".maestro/exchange-phase.yaml");

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

  test("the hold plus the AI's own delay stays under the yaml's post-exchange btn-passa wait", () => {
    // app/game.tsx suspends the AI turn for the whole hold (`exchangeAnnouncing`
    // gates `aiTurnKey`), so a bump to either number here can silently blow the
    // other's budget without either file's own test noticing.
    const holdMatch = gameContext.match(/const E2E_EXCHANGE_HOLD_MS = ([\d_]+);/);
    assert.ok(holdMatch, "E2E_EXCHANGE_HOLD_MS constant not found in GameContext.tsx");
    const holdMs = Number(holdMatch[1].replace(/_/g, ""));

    const aiDelayMatch = offlineScreen.match(/const AI_DELAY = E2E_FAST \? (\d+) : \d+;/);
    assert.ok(aiDelayMatch, "AI_DELAY's E2E_FAST branch not found in app/game.tsx");
    const aiDelayMs = Number(aiDelayMatch[1]);

    const afterExchangeAnnounce = exchangePhaseFlow.slice(
      exchangePhaseFlow.indexOf('id: "exchange-announce"')
    );
    const passaWait = afterExchangeAnnounce.match(/id:\s*"btn-passa"[\s\S]*?timeout:\s*(\d+)/);
    assert.ok(
      passaWait,
      "no btn-passa wait found after the exchange-announce wait in .maestro/exchange-phase.yaml"
    );
    const passaTimeoutMs = Number(passaWait[1]);

    assert.ok(
      holdMs + aiDelayMs < passaTimeoutMs,
      `E2E_EXCHANGE_HOLD_MS (${holdMs}) + AI_DELAY (${aiDelayMs}) must stay under ` +
        `exchange-phase.yaml's post-exchange btn-passa wait (${passaTimeoutMs})`
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
