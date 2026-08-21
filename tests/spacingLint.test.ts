// tests/spacingLint.test.ts — the design-token lint rules, exercised.
//
// They are correct, and they were watched failing when they were written. That
// is not the same as being pinned: one bad edit to a selector reopens the same
// silent hole with CI green, which is exactly how `marginHorizontal`,
// `marginVertical` and negative literals came to be uncovered the first time.
//
// The selectors here are the ones `eslint.config.js` runs — imported from
// eslint.selectors.cjs, which both read. A test that restated them would be a
// copy, and a copy drifts: the same hole, in a new place.
//
// ESLint is driven through its own `Linter` rather than the project config, so
// this loads no Expo config, no plugins and no `node_modules` tree beyond the
// parser. The rule text under test is still the real one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);
const selectors = require("../eslint.selectors.cjs") as {
  SCALED_LITERAL: string;
  TOKEN_AS_STRING: string;
  TOKEN_AS_TEMPLATE: string;
};

const linter = new Linter({ configType: "flat" });

/** How many violations of `selector` the real linter finds in `code`. */
function violations(code: string, selector: string): number {
  return linter.verify(code, {
    languageOptions: { parser: tsParser as never },
    rules: { "no-restricted-syntax": ["error", { selector, message: "violation" }] },
  }).length;
}

const flagged = (code: string) => violations(code, selectors.SCALED_LITERAL) > 0;

describe("the bare-number rule covers the whole scale", () => {
  // The two that shipped uncovered, and the shorthand family they belong to.
  // Enumerated rather than generated: a generator built from the same regex the
  // selector uses would agree with a broken selector.
  const SCALED = [
    "padding",
    "paddingTop",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingStart",
    "paddingEnd",
    "paddingVertical",
    "paddingHorizontal",
    "margin",
    "marginTop",
    "marginBottom",
    "marginLeft",
    "marginRight",
    "marginStart",
    "marginEnd",
    "marginVertical",
    "marginHorizontal",
    "gap",
    "rowGap",
    "columnGap",
    "fontSize",
    "borderRadius",
  ];

  for (const prop of SCALED) {
    test(`${prop}: a bare number is refused`, () => {
      assert.ok(flagged(`const s = { ${prop}: 12 };`), `${prop} accepted a bare number`);
    });
  }

  test("a negative literal is refused too — it parses as a unary expression", () => {
    // One selector alone leaves half the scale unguarded, which is the whole
    // reason there are two.
    assert.ok(flagged("const s = { marginTop: -8 };"), "a negative margin was accepted");
    assert.ok(flagged("const s = { marginHorizontal: -4 };"));
  });

  test("a decimal is refused", () => {
    assert.ok(flagged("const s = { padding: 2.5 };"));
  });
});

describe("the bare-number rule refuses nothing it should not", () => {
  // The floor. Every assertion above still passes if the selector matched
  // everything, and a rule that fires on `flex: 1` would be turned off within
  // a day — after which none of it is enforced at all.
  const ALLOWED: [string, string][] = [
    ["a token", "const s = { padding: Spacing.md };"],
    ["zero", "const s = { padding: 0 };"],
    ["a named constant", "const s = { padding: CARD_GAP };"],
    ["a property that is not on a scale", "const s = { flex: 1 };"],
    ["a width", "const s = { width: 260 };"],
    ["a height", "const s = { height: 44 };"],
    ["a z-index", "const s = { zIndex: 110 };"],
    ["an opacity", "const s = { opacity: 1 };"],
    ["a number that is not in a style object", "const timeout = 12;"],
  ];

  for (const [label, code] of ALLOWED) {
    test(`${label} is accepted`, () => {
      assert.ok(!flagged(code), `${label} was refused: ${code}`);
    });
  }
});

describe("a design token written as a string", () => {
  const asString = (code: string) => violations(code, selectors.TOKEN_AS_STRING) > 0;
  const asTemplate = (code: string) => violations(code, selectors.TOKEN_AS_TEMPLATE) > 0;

  test("is refused — it type-checks and renders as nothing", () => {
    assert.ok(asString('const s = { color: "Colors.success" };'));
    assert.ok(asString('const s = { color: "Spacing.md" };'));
  });

  test("is refused in a template literal too", () => {
    assert.ok(asTemplate("const s = { color: `Colors.gold` };"));
  });

  test("the token referenced properly is accepted", () => {
    assert.ok(!asString("const s = { color: Colors.success };"));
    assert.ok(!asTemplate("const s = { color: Colors.success };"));
  });

  test("an unrelated string is accepted", () => {
    assert.ok(!asString('const s = { color: "red" };'));
    assert.ok(!asString('const label = "Colors are nice";'));
  });
});

describe("the selectors under test are the ones that ship", () => {
  // Without this the suite could pass against selectors nobody runs.
  test("eslint.config.js uses each of them by reference", () => {
    const config = require("../eslint.config.js") as {
      rules?: Record<string, unknown>;
    }[];
    const restricted = config
      .flatMap((block) => {
        const rule = block.rules?.["no-restricted-syntax"];
        return Array.isArray(rule) ? rule.slice(1) : [];
      })
      .filter((entry): entry is { selector: string } => typeof entry === "object" && entry !== null);

    const shipped = restricted.map((entry) => entry.selector);
    for (const name of ["SCALED_LITERAL", "TOKEN_AS_STRING", "TOKEN_AS_TEMPLATE"] as const) {
      assert.ok(
        shipped.includes(selectors[name]),
        `${name} is not among the selectors eslint.config.js enforces`
      );
    }
  });
});
