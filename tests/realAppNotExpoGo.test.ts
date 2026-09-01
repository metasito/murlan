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

/**
 * The file with its whole-line comments removed, which is what every positive
 * assertion below reads. The negative ones read `read()` instead, deliberately:
 * a step left commented out is a step someone is about to put back. That same
 * property inverts here — commenting out the build, or the `maestro` line, is
 * the ordinary way somebody bisects a red device job, and against the raw text
 * every claim in this file would go on passing while the job drove nothing.
 */
const code = (rel: string) => read(rel).replace(/^[ \t]*#.*$/gm, "");

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
function flowBody(rel: string, src: (rel: string) => string = read): string {
  return src(rel).split(/^---$/m).slice(1).join("---");
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

describe("both device jobs pin the tool that reads the screen", () => {
  // Maestro decides what "the app rendered" means, and installed unpinned it
  // was the one thing in either job that could change between two runs of the
  // same commit. 2.7.0 rewrote the iOS hierarchy retrieval and arrived with no
  // commit to bisect against (#701).
  for (const rel of [".github/workflows/ios.yml", ".github/workflows/maestro.yml"]) {
    test(`${rel} asks for a version, before it fetches`, () => {
      const install = code(rel);
      const pin = install.search(/export MAESTRO_VERSION=\d+\.\d+\.\d+/);
      const fetch = install.indexOf("get.maestro.mobile.dev");
      assert.notEqual(pin, -1, `${rel} takes whatever version is current`);
      assert.notEqual(fetch, -1, `${rel} no longer installs Maestro at all`);
      // The install script reads the variable from its environment, so a pin
      // written below the pipe sets nothing and installs latest in silence.
      assert.ok(pin < fetch, `${rel} names the version after fetching, which pins nothing`);
    });
  }

  test("both jobs pin the same version", () => {
    const version = (rel: string) => code(rel).match(/MAESTRO_VERSION=(\d+\.\d+\.\d+)/)?.[1];
    assert.equal(
      version(".github/workflows/ios.yml"),
      version(".github/workflows/maestro.yml"),
      "the two loops would be reading the screen with different tools",
    );
  });

  test("each run states the version it actually used", () => {
    // The pin is what was asked for; this is what arrived. They differ if the
    // release is ever retagged, and a run that cannot say which it ran is a
    // run whose evidence cannot be trusted later.
    for (const rel of [".github/workflows/ios.yml", ".github/workflows/maestro.yml"]) {
      assert.match(code(rel), /maestro" --version/, `${rel}'s log does not name its Maestro`);
    }
  });
});

describe("the iOS job drives this app, not Expo Go", () => {
  const workflow = code(".github/workflows/ios.yml");

  test("it builds and installs a build of this app", () => {
    assert.match(workflow, /expo prebuild --platform ios/);
    assert.match(workflow, /xcodebuild/);
    assert.match(workflow, /simctl install .*APP_BUNDLE/);
  });

  test("it never fetches or installs Expo Go", () => {
    for (const trace of [/iosClientUrl/, /expo-go/i, /host\.exp/i]) {
      assert.doesNotMatch(read(".github/workflows/ios.yml"), trace, `ios.yml still mentions ${trace}`);
    }
  });

  test("it tells the flows which app they are driving", () => {
    assert.match(workflow, /maestro .*\btest -e MAESTRO_APP_ID=/);
  });

  test("the app id comes from the built app rather than being written twice", () => {
    assert.match(workflow, /PlistBuddy -c 'Print :CFBundleIdentifier'/);
  });

  test("it tells Maestro which simulator to drive", () => {
    // Left to resolve the target itself, Maestro's driver failed to start in
    // three of eight dispatches. Which device, not where the flag sits —
    // `--device` is accepted both before `test` and on the subcommand.
    assert.match(workflow, /maestro\b[^\n]*--device "\$SIMULATOR_UDID"/);
  });
});

describe("every flow asks for the locale it selects on", () => {
  for (const rel of FLOWS) {
    test(`${rel} launches the app in Italian`, () => {
      // The parentheses are the whole point: AppleLanguages is a list, and
      // NSUserDefaults' argument domain parses `(it-IT)` as one. A bare
      // `it-IT` sets a string, the locale lookup ignores it, and the app comes
      // up in English against a flow that selects on Italian copy — which
      // reads as the app never having rendered.
      const launch = flowBody(rel, code)
        .split(/^(?=- )/m)
        .find((b) => /^- launchApp:/.test(b));
      assert.ok(launch, `${rel} has no top-level launchApp`);
      assert.match(launch, /AppleLanguages:\s*"\(it-IT\)"/, `${rel} does not ask for Italian`);
      assert.match(launch, /AppleLocale:\s*"it_IT"/, `${rel} does not ask for Italian formats`);
    });
  }
});

describe("the Android job drives this app, not Expo Go", () => {
  const workflow = code(".github/workflows/maestro.yml");
  const action = code(".github/actions/drive-android-flows/action.yml");
  const workflowText = read(".github/workflows/maestro.yml");
  const actionText = read(".github/actions/drive-android-flows/action.yml");

  test("it builds and installs a build of this app", () => {
    assert.match(workflow, /expo prebuild --platform android/);
    assert.match(workflow, /assembleRelease/);
    assert.match(action, /adb install .*APP_APK/);
  });

  test("it never fetches or installs Expo Go", () => {
    // The Expo Go client came from a network fetch resolved against the pinned
    // SDK, and the app was reached by a deep link into it. Either one returning
    // is the whole class coming back.
    for (const trace of [/androidClientUrl/, /expo-go/i, /host\.exp/i, /exp:\/\//]) {
      assert.doesNotMatch(workflowText, trace, `maestro.yml still mentions ${trace}`);
      assert.doesNotMatch(actionText, trace, `drive-android-flows still mentions ${trace}`);
    }
  });

  test("it starts no dev server, because a release build carries its bundle", () => {
    // A release APK needs no packager. Starting one again would mean the build
    // is loading its JavaScript from somewhere else, which is a different app.
    for (const trace of [/expo start/, /8081/, /adb reverse/]) {
      assert.doesNotMatch(workflowText, trace, `maestro.yml still mentions ${trace}`);
      assert.doesNotMatch(actionText, trace, `drive-android-flows still mentions ${trace}`);
    }
  });

  test("it tells the flows which app they are driving, and names the device", () => {
    assert.match(action, /maestro\b[^\n]*--device\b/);
    assert.match(action, /test -e MAESTRO_APP_ID=/);
  });

  test("the package name comes from the built APK rather than being written twice", () => {
    assert.match(workflow, /dump packagename/);
  });

  test("the crash check looks for our own package", () => {
    // Grepping the host's process name finds nothing once the host is gone,
    // and a check that can no longer match reports nothing rather than failing.
    assert.match(workflow, /grep -rl ">>> \$APP_ID"/);
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
