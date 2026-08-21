// tests/appVersions.test.ts — the store build counters stay out of app.json.
//
// eas.json sets `appVersionSource: "remote"`, under which Expo ignores
// `ios.buildNumber` and `android.versionCode` in app config entirely. A value
// added there is therefore never read, never incremented, and drifts from the
// counter the stores enforce — while reading, to anyone opening the file, as
// the authority. `eas build:version:sync` writes exactly that state, so the
// mistake is one command away. docs/DEPLOY-RUNBOOK.md § Store build numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function config(name: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(repoRoot, name), "utf8"));
}

/** The two paths Expo reads a build counter from, if they are set at all. */
function localCounters(appJson: Record<string, any>): string[] {
  const expo = appJson.expo ?? {};
  return [
    ["ios.buildNumber", expo.ios?.buildNumber],
    ["android.versionCode", expo.android?.versionCode],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
}

test("eas.json still sources the build version remotely", () => {
  const eas = config("eas.json");
  assert.equal(
    eas.cli?.appVersionSource,
    "remote",
    "the rule the rest of this file pins comes from remote sourcing; if this moved to " +
      "`local`, app.json becomes the authority and § Store build numbers is now wrong"
  );
  assert.equal(
    eas.build?.production?.autoIncrement,
    true,
    "with nothing incrementing the remote counter, a submission ships the same build number " +
      "twice and the store rejects the second"
  );
});

test("app.json carries no build counter", () => {
  assert.deepEqual(
    localCounters(config("app.json")),
    [],
    "EAS ignores these under `appVersionSource: \"remote\"`. Delete them and read the " +
      "counter with `eas build:version:sync`, reverting the file after"
  );
});

// The floor: without this, the test above passes just as happily against a
// typo'd path that inspects nothing at all.
test("a build counter in app.json is what that check reports", () => {
  const planted = config("app.json");
  planted.expo.ios.buildNumber = "7";
  planted.expo.android.versionCode = 7;
  assert.deepEqual(localCounters(planted), [
    'ios.buildNumber = "7"',
    "android.versionCode = 7",
  ]);
});
