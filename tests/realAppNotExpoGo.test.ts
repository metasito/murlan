// tests/realAppNotExpoGo.test.ts — Expo Go cannot host a UI suite, and the
// evidence took four sessions to find. Its dev-menu window sits above the app's
// own and takes the touch: run 33397453801's simulator log has the tap on
// "Salta il tutorial" dispatched `to window: <EXDevMenuWindow>`, which then
// resigns key — the tap is spent dismissing an invisible window and the app
// never sees it. A `back` **key** works on the same screen, because keys go to
// the app rather than through window hit-testing (#627).
//
// Across every Android and iOS run this repo has recorded, the only taps that
// ever landed were on Expo Go's own native dialogs. So "the flow passed" under
// Expo Go was never a claim about the app.
//
// What this pins is the shape that fixes it, not the symptom: the iOS job
// installs a build of *this app*, and the packager dance every flow still
// carries for Expo Go is nested under a condition rather than run
// unconditionally. Reintroducing either is how the suite goes back to
// measuring Expo Go.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const FLOWS = [".maestro/smoke.yaml", ".maestro/offline-game.yaml"];

/**
 * The names of the flow's top-level commands, which are the ones that run
 * unconditionally. Read as text rather than parsed: js-yaml is here only as
 * somebody else's transitive dependency, and a check that disappears when the
 * tree is deduped is not a check.
 *
 * A top-level command is a `- ` at column 0 after the `---` that ends the
 * config header; anything indented belongs to a block above it.
 */
function topLevelCommands(rel: string): string[] {
  return [...flowBody(rel).matchAll(/^- (\w+)/gm)].map((m) => m[1]);
}

/** Everything after the `---` that ends the config header. */
function flowBody(rel: string): string {
  return read(rel).split(/^---$/m).slice(1).join("---");
}

/**
 * The one top-level block containing `openLink`, which is the packager
 * hand-off. Split the same way `topLevelCommands` counts: a `- ` at column 0
 * opens a block, and everything indented under it belongs to that block.
 */
function packagerBlock(rel: string): string {
  const blocks = flowBody(rel).split(/^(?=- )/m);
  const found = blocks.filter((b) => /openLink:/.test(b));
  assert.equal(found.length, 1, `${rel} should reach the packager from exactly one block`);
  return found[0];
}

describe("the iOS job drives this app, not Expo Go", () => {
  const workflow = read(".github/workflows/ios.yml");

  test("it builds and installs a build of this app", () => {
    assert.match(workflow, /expo prebuild --platform ios/);
    assert.match(workflow, /xcodebuild/);
    assert.match(workflow, /simctl install .*APP_BUNDLE/);
  });

  test("it never fetches or installs Expo Go", () => {
    // Comments are searched too, deliberately: a step left commented out is a
    // step someone is about to put back.
    for (const trace of [/iosClientUrl/, /expo-go/i, /host\.exp/i]) {
      assert.doesNotMatch(workflow, trace, `ios.yml still mentions ${trace}`);
    }
  });

  test("it tells the flows which app they are driving", () => {
    assert.match(workflow, /maestro test -e MAESTRO_APP_ID=/);
  });

  test("the app id comes from the built app rather than being written twice", () => {
    assert.match(workflow, /PlistBuddy -c 'Print :CFBundleIdentifier'/);
  });
});

describe("every flow can be driven without a packager", () => {
  for (const rel of FLOWS) {
    test(`${rel} reaches the packager only under a condition`, () => {
      const top = topLevelCommands(rel);
      // `openLink` is the packager hand-off and `stopApp` is what makes Expo Go
      // take the link as a cold start. Neither means anything to a real build,
      // and at the top level both would run against one.
      assert.ok(!top.includes("openLink"), `${rel} opens the packager link unconditionally`);
      assert.ok(!top.includes("stopApp"), `${rel} stops the app unconditionally`);
    });

    test(`${rel} gates the packager on which app is being driven`, () => {
      // Nesting alone proves nothing: a wrapper whose `when:` was dropped is
      // still not top-level, and would run the whole Expo Go hand-off against
      // a real build while this file went on passing.
      const block = packagerBlock(rel);
      const gate = block.slice(0, block.indexOf("openLink:"));
      assert.match(gate, /when:/, `${rel}'s packager block has no condition above it`);
      assert.match(
        gate,
        /MAESTRO_APP_ID/,
        `${rel}'s packager block is not gated on which app is being driven`
      );
    });

    test(`${rel} still launches something`, () => {
      assert.ok(topLevelCommands(rel).includes("launchApp"), `${rel} never launches the app`);
    });

    test(`${rel} takes the app id from MAESTRO_APP_ID`, () => {
      const appId = read(rel).match(/^appId:.*$/m)?.[0];
      assert.match(String(appId), /MAESTRO_APP_ID/);
    });
  }
});
