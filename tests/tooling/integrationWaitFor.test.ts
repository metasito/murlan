// tests/tooling/integrationWaitFor.test.ts — a file-local waitFor drifts from tests/helpers/client.ts:
// the two it replaced resolved null on timeout and ignored DEADLINE_SCALE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const OWN_WAIT_FOR = /\b(?:function\s*\*?\s*|(?:const|let|var)\s+)(waitFor|waitForOrNull)\b(?!\w)/g;

const declared = (source: string) => [...source.matchAll(OWN_WAIT_FOR)].map((m) => m[1]);

test("the scan finds every shape a local waitFor is declared in", () => {
  const planted = [
    "function waitFor<T>(socket: Socket, event: string, ms = 6_000): Promise<T | null> {}",
    "async function waitFor(socket, event) {}",
    "const waitFor = <T,>(s: Socket, e: string) => new Promise<T>(() => {});",
    "let waitForOrNull = () => null;",
  ];
  assert.deepEqual(planted.map((src) => declared(src).length), [1, 1, 1, 1]);
  assert.deepEqual(
    declared('import { waitFor, waitForOrNull } from "../helpers/client.ts";\nasync function waitForPush() {}'),
    [],
    "an import of the shared helper, or a differently named one, is not a local waitFor"
  );
});

test("no integration file declares its own waitFor", () => {
  const files = readdirSync("tests/integration").filter((f) => f.endsWith(".test.ts"));
  assert.ok(files.length >= 10, `found only ${files.length} integration files — the scan reads the wrong directory`);
  const local = files.filter((f) => declared(readFileSync(`tests/integration/${f}`, "utf8")).length > 0);
  assert.deepEqual(local, [], "import waitFor or waitForOrNull from tests/helpers/client.ts instead");
});
