// tests/keyboardAvoidance.test.ts — a text field must not sit under the soft
// keyboard the player is typing on. No render test can see this: CLAUDE.md's
// rule applies, since react-test-renderer never runs layout and Playwright has
// no soft keyboard. So this is a source scan, in the shape of
// tests/orientation.test.ts.
//
// Trust is derived, not declared: MenuLayout counts as a keyboard-aware
// wrapper only while its own source still carries the props that make it one.
// Hardcoding it as trusted would have passed green on the very file that was
// broken.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, jsxTags } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every .tsx under app/ and components/, as [repoRelativePath, source]. */
function screenSources(): [string, string][] {
  return ["app", "components"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx"))
      .map((f): [string, string] => {
        const rel = path.posix.join(dir, f.split(path.sep).join("/"));
        return [rel, readFileSync(path.join(repoRoot, dir, f), "utf8")];
      })
  );
}

const MENU_LAYOUT = "components/MenuLayout.tsx";

/**
 * iOS rides the ScrollView's own keyboard inset; Android needs the component,
 * because edge-to-edge stopped the window resizing under the IME.
 */
function isKeyboardAware(src: string): boolean {
  return src.includes("automaticallyAdjustKeyboardInsets") && src.includes("<KeyboardAvoidingView");
}

/** A wrapper a TextInput may sit inside without being covered. */
function trustedWrappers(sources: [string, string][]): string[] {
  const menuLayout = sources.find(([file]) => file === MENU_LAYOUT);
  assert.ok(menuLayout, `expected ${MENU_LAYOUT} to exist`);
  return [
    "<KeyboardAvoidingView",
    ...(isKeyboardAware(menuLayout[1]) ? ["<MenuLayout"] : []),
  ];
}

/** Files rendering a <TextInput>, by the same "not <TextInputFoo>" rule. */
function filesWithTextInput(sources: [string, string][]): [string, string][] {
  return sources.filter(([, src]) => /<TextInput[\s/>]/.test(src));
}

describe("no text field is left under the keyboard", () => {
  test("MenuLayout, which every menu screen with a field routes through, is keyboard-aware", () => {
    const sources = screenSources();
    const menuLayout = sources.find(([file]) => file === MENU_LAYOUT);
    assert.ok(menuLayout, `expected ${MENU_LAYOUT} to exist`);
    assert.ok(
      menuLayout[1].includes("automaticallyAdjustKeyboardInsets"),
      `${MENU_LAYOUT}'s ScrollView must set automaticallyAdjustKeyboardInsets — iOS's leg`
    );
    assert.ok(
      menuLayout[1].includes("<KeyboardAvoidingView"),
      `${MENU_LAYOUT} must wrap its body in KeyboardAvoidingView — Android's leg, since ` +
        `edge-to-edge stopped adjustResize reflowing the window`
    );
  });

  test("every screen with a text field renders it inside a keyboard-aware wrapper", () => {
    const sources = screenSources();
    const trusted = trustedWrappers(sources);
    const offenders = filesWithTextInput(sources)
      .filter(([, src]) => !trusted.some((wrapper) => src.includes(wrapper)))
      .map(([file]) => file);

    assert.deepEqual(
      offenders,
      [],
      `these render a TextInput with no keyboard-aware wrapper: ${offenders.join(", ")}`
    );
  });

  // Without this, a scanner that silently stops matching passes green having
  // checked nothing at all.
  test("the scan actually found the screens it is meant to be checking", () => {
    const sources = screenSources();
    assert.ok(sources.length > 30, `expected app/ and components/ .tsx files, got ${sources.length}`);

    const withInput = filesWithTextInput(sources).map(([file]) => file);
    assert.ok(
      withInput.length >= 4,
      `expected the screens carrying a text field, got ${withInput.length}: ${withInput.join(", ")}`
    );
  });
});

describe("one keyboard strategy", () => {
  /** Every `behavior={…}` written on a KeyboardAvoidingView, with its file. */
  function behaviours(): { file: string; expression: string }[] {
    const out: { file: string; expression: string }[] = [];
    for (const [file, src] of screenSources()) {
      const opening = jsxTags(blankComments(src)).filter(
        (t) => t.name === "KeyboardAvoidingView" && !t.isClose
      );
      for (const tag of opening) {
        const behavior = /behavior=\{([\s\S]*?)\}\s*(?:\w|\/?>|$)/.exec(tag.text);
        out.push({ file, expression: behavior ? behavior[1].trim() : "" });
      }
    }
    return out;
  }

  test("every KeyboardAvoidingView takes its behaviour from keyboardBehavior", () => {
    const rogue = behaviours().filter(
      (b) => !b.expression.includes("keyboardBehavior") || /["'](padding|height)["']/.test(b.expression)
    );
    assert.deepEqual(
      rogue.map((b) => `${b.file}: behavior={${b.expression}}`),
      [],
      "these pick their own strategy. Two that disagree is how the sign-in screen came to run " +
        "opposite ones at once; call keyboardBehavior() from lib/keyboard.ts instead"
    );
  });

  /**
   * A screen inside `MenuLayout` already has one, so a second is two answers to
   * one event — including one inside a `<Modal>`, which moves the screen behind
   * it. Order is not read: the wrapper may be written either side of the layout,
   * and `avoidsKeyboard={false}` is the way to say the modal's is the only one.
   */
  test("no screen renders both MenuLayout and a KeyboardAvoidingView of its own", () => {
    const doubled = screenSources()
      .filter(([file]) => file !== MENU_LAYOUT)
      .filter(([, src]) => {
        const code = blankComments(src);
        if (!/<MenuLayout[\s/>]/.test(code) || !/<KeyboardAvoidingView[\s/>]/.test(code)) return false;
        return !/avoidsKeyboard=\{false\}/.test(code);
      })
      .map(([file]) => file);
    assert.deepEqual(
      doubled,
      [],
      `MenuLayout brings its own; pass avoidsKeyboard={false} if the modal's is the real one: ${doubled.join(", ")}`
    );
  });

  // The floor: a walk finding nothing, or a tag regex matching nothing, passes
  // both assertions above.
  test("the scan finds the views and the layouts it is judging", () => {
    const found = behaviours();
    assert.ok(found.length >= 3, `only ${found.length} KeyboardAvoidingView(s) found`);
    assert.ok(
      found.every((b) => b.expression.length > 0),
      `a KeyboardAvoidingView with no behaviour was read as compliant: ${JSON.stringify(found)}`
    );
    const layouts = screenSources().filter(([, src]) => /<MenuLayout[\s/>]/.test(src));
    assert.ok(layouts.length >= 5, `only ${layouts.length} screen(s) render MenuLayout`);
  });
});
