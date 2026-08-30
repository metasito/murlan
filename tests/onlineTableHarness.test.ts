// tests/onlineTableHarness.test.ts — the two claims #590 makes about how the
// online table is reached.
//
// One: the harness that reaches it is test-only, so nothing it adds can be a
// way into a real player's game. It is checked rather than asserted in a
// sentence because "it is only a Playwright helper" is exactly the sort of
// thing that stops being true a release later.
//
// Two: nothing lands on the app's root without seeding the tutorial answer
// first. A screen that decides to push `/tutorial` after the home screen has
// rendered navigates the page out from under whatever clicked, and every later
// wait then burns its full timeout with nothing to say about why — which is
// what stalled the #57 survey twice and left the online table unphotographed.
// `openApp` (tests/e2e/helpers/navigation.ts) seeds the answer; this refuses a
// root navigation that has not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(repoRoot, "tests", "e2e");
const HARNESS = path.join(E2E, "helpers", "onlineTable.ts");

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(repoRoot, file).replace(/\\/g, "/");

test("the online-table harness is reachable only from the browser suite", () => {
  const source = blankComments(readFileSync(HARNESS, "utf8"));
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

  // Resolved rather than matched on the leading dot: `../../../lib/gameEngine`
  // starts with one and lands in the product, which is exactly what this
  // refuses. A sibling helper (`tests/e2e/helpers/offlineSeed.ts`) does reach
  // that way, deliberately — this one may not, because what it reaches into
  // would then be a seam the product carries.
  const outside = imports.filter((spec) => {
    if (spec === "@playwright/test") return false;
    if (!spec.startsWith(".")) return true;
    return !path.resolve(path.dirname(HARNESS), spec).startsWith(path.join(repoRoot, "tests"));
  });
  assert.deepEqual(
    outside,
    [],
    `${rel(HARNESS)} imports ${outside.join(", ")} — a harness that reaches outside the ` +
      `suite is a seam the product carries`
  );

  // …and nothing shipped reaches back. The bundle is what a player downloads
  // and the server is what answers them; neither may name this file.
  const shipped = [
    ...walk(path.join(repoRoot, "app"), (n) => n.endsWith(".ts") || n.endsWith(".tsx")),
    ...walk(path.join(repoRoot, "server"), (n) => n.endsWith(".ts")),
    ...walk(path.join(repoRoot, "components"), (n) => n.endsWith(".ts") || n.endsWith(".tsx")),
    ...walk(path.join(repoRoot, "lib"), (n) => n.endsWith(".ts") || n.endsWith(".tsx")),
  ];
  const referring = shipped.filter((file) => readFileSync(file, "utf8").includes("onlineTable"));
  assert.deepEqual(
    referring.map(rel),
    [],
    `these shipped files name the test-only online-table harness: ${referring.map(rel).join(", ")}`
  );

  // The floor: a scan that found no shipped files would pass the check above
  // having read nothing.
  assert.ok(shipped.length > 100, `only ${shipped.length} shipped files were scanned`);
});

test("nothing in the browser suite opens the app's root without seeding the tutorial answer", () => {
  // `page.goto(baseURL)` and `page.goto(`${baseURL}/`)` — the two spellings of
  // the root. A deep link to a named route is not affected: the decision that
  // pushes `/tutorial` is the title screen's.
  //
  // The scope is the file, not the call, and deliberately: a spec reaches the
  // root through a local helper as often as directly (`profileSignedOut.spec.ts`
  // does both), so asking which test a seed belongs to would refuse the files
  // that already do this correctly. What it catches is the shape that matters —
  // a harness that opens the app and never seeds at all.
  const ROOT_GOTO = /\.goto\(\s*(?:baseURL!?\s*\)|`\$\{baseURL!?\}\/?`)/;
  const files = walk(E2E, (n) => n.endsWith(".ts"));
  const offenders: string[] = [];

  for (const file of files) {
    const source = blankComments(readFileSync(file, "utf8"));
    if (!ROOT_GOTO.test(source)) continue;
    if (source.includes("openApp") || source.includes("@murlan_tutorial_seen")) continue;
    offenders.push(rel(file));
  }

  assert.deepEqual(
    offenders,
    [],
    `these open the app's root without seeding the tutorial answer, so the title screen can ` +
      `push /tutorial out from under them: ${offenders.join(", ")}`
  );

  // The floor: the regex finding nothing anywhere would pass having checked
  // nothing. `helpers/navigation.ts` is the one file that must always match.
  const rootNavigators = files.filter((file) => ROOT_GOTO.test(blankComments(readFileSync(file, "utf8"))));
  assert.ok(
    rootNavigators.some((file) => file.endsWith(path.join("helpers", "navigation.ts"))),
    "the scan no longer recognises openApp's own root navigation, so it recognises nobody's"
  );
});
