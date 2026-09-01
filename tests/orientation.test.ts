// tests/orientation.test.ts — a player already holding the device in landscape
// must never be yanked into portrait. React Native's <Modal> defaults to
// supportedOrientations={["portrait"]} on iOS, so a modal opened in landscape
// rotates the whole app and leaves the screen underneath laid out for the old
// size — every tap then lands on nothing. Only the game table may force an
// orientation, and only to landscape, because it is the one screen that needs
// the width.
//
// The prop used to be declared at each modal, which is one place per modal to
// forget it. components/AppModal.tsx is now the only <Modal> in the app, and
// what this pins is that it stays the only one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every .tsx under app/ and components/, as [repoRelativePath, source]. */
function screenSources(): [string, string][] {
  return ["app", "components"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx"))
      .map((f): [string, string] => {
        const rel = path.posix.join(dir, f.split(path.sep).join("/"));
        return [rel, blankComments(readFileSync(path.join(repoRoot, dir, f), "utf8"))];
      })
  );
}

/**
 * The text of every `<Modal …>` opening tag in `src`. Scans to the matching
 * `>` while skipping strings and braced expressions, so a `>` inside a prop
 * value does not end the tag early.
 */
function modalOpeningTags(src: string): string[] {
  const tags: string[] = [];
  const TAG = "<Modal";
  for (let i = src.indexOf(TAG); i !== -1; i = src.indexOf(TAG, i + 1)) {
    // `<ModalFoo` is a different component.
    if (/[A-Za-z0-9_]/.test(src[i + TAG.length] ?? "")) continue;
    let depth = 0;
    let quote = "";
    for (let j = i + TAG.length; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      } else if (c === ">" && depth === 0) {
        tags.push(src.slice(i, j + 1));
        break;
      }
    }
  }
  return tags;
}

describe("orientation is never narrowed behind the player's back", () => {
  test("every <Modal> declares supportedOrientations including landscape", () => {
    const offenders: string[] = [];
    for (const [file, src] of screenSources()) {
      for (const tag of modalOpeningTags(src)) {
        if (!tag.includes("supportedOrientations")) {
          offenders.push(`${file}: <Modal> without supportedOrientations`);
        } else if (!tag.includes("landscape")) {
          offenders.push(`${file}: supportedOrientations omits landscape`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a <Modal> without landscape support rotates the app to portrait on iOS:\n${offenders.join("\n")}`
    );
  });

  test("at least one <Modal> is actually covered, so the scan cannot pass vacuously", () => {
    const total = screenSources().reduce(
      (n, [, src]) => n + modalOpeningTags(src).length,
      0
    );
    assert.ok(total > 0, "found no <Modal> at all — the scanner is broken");
  });

  // Strictly stronger than the prop check above, which a new modal passes by
  // remembering the prop. One shell is a site nobody has to remember at.
  test("components/AppModal.tsx is the app's only <Modal>", () => {
    const SHELL = "components/AppModal.tsx";
    const declaring = screenSources()
      .filter(([, src]) => modalOpeningTags(src).length > 0)
      .map(([file]) => file);
    assert.deepEqual(
      declaring,
      [SHELL],
      `render <AppModal> instead — a second <Modal> is a second place to get ` +
        `supportedOrientations, statusBarTranslucent and onRequestClose wrong: ${declaring.join(", ")}`
    );
  });

  test("only the game table forces an orientation", () => {
    const lockers = screenSources()
      .filter(([, src]) => src.includes("lockAsync"))
      .map(([file]) => file);
    assert.deepEqual(
      lockers,
      ["components/GameTable.tsx"],
      "the game table is the only screen allowed to force an orientation"
    );
  });

  test("the game table forces landscape, never portrait", () => {
    const src = readFileSync(path.join(repoRoot, "components", "GameTable.tsx"), "utf8");
    assert.match(src, /lockAsync\(\s*ScreenOrientation\.OrientationLock\.LANDSCAPE\s*\)/);
    assert.ok(
      !/OrientationLock\.PORTRAIT/.test(src),
      "nothing may lock the player into portrait"
    );
  });

  test("app.json leaves the app free to rotate", () => {
    const appJson = JSON.parse(
      readFileSync(path.join(repoRoot, "app.json"), "utf8")
    ) as { expo: { orientation?: string } };
    assert.equal(
      appJson.expo.orientation,
      "default",
      'app.json must stay orientation:"default" — pinning it to portrait would ' +
        "override every per-screen decision"
    );
  });
});
