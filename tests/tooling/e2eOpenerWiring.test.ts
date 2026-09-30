import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { E2E_OPENER_KEY } from "../../lib/e2eOpener.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
const gameContext = read("context/GameContext.tsx");

test("only an E2E_FAST build on iOS reads the opener launch argument", () => {
  assert.match(gameContext, /^const E2E_FAST = process\.env\.EXPO_PUBLIC_E2E_FAST === "1";$/m);
  assert.match(
    gameContext,
    /^const E2E_OPENER = E2E_FAST && Platform\.OS === "ios" && String\(Settings\.get\(E2E_OPENER_KEY\)\) === "1";$/m
  );
});

test("setupGame, and nothing else, deals the opener to the viewer, and only behind the gate", () => {
  const calls = [...gameContext.matchAll(/initializeOpeningAt\(/g)];
  assert.equal(calls.length, 1, "initializeOpeningAt is called exactly once");
  const at = calls[0].index!;
  const setupGame = gameContext.indexOf("const setupGame");
  const next = gameContext.indexOf("const dealFrom");
  assert.ok(setupGame >= 0 && setupGame < at && at < next, "the call sits inside setupGame");
  assert.match(gameContext.slice(setupGame, next), /E2E_OPENER\s*\?\s*initializeOpeningAt\(/);
});

test("every flow that taps the opening card asks for the opener by the key the app reads, and waits for it on iOS", () => {
  const flows = readdirSync(path.join(repoRoot, ".maestro"))
    .filter((f) => f.endsWith(".yaml"))
    .filter((f) => read(`.maestro/${f}`).includes('id: "card-start"'));
  assert.ok(flows.length >= 3, `only ${flows.length} flows tap the opening card`);
  for (const f of flows) {
    const flow = read(`.maestro/${f}`);
    assert.match(flow, new RegExp(`^ {6}${E2E_OPENER_KEY}: "1"$`, "m"), `${f} does not pass ${E2E_OPENER_KEY}`);
    assert.match(
      flow,
      /when:\n\s+platform: iOS\n\s+commands:\n\s+- extendedWaitUntil:\n\s+visible: "Inizi tu\.\*"/,
      `${f} does not wait for the opener on iOS`
    );
  }
});
