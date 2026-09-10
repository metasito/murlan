// tests/submitEditingGuards.test.ts — an input that submits on the return key
// needs both halves of the in-flight guard, and each half covers a platform the
// other misses. `editable={false}` is what iOS and Android honour. On web it
// becomes `readOnly` (react-native-web `exports/TextInput/index.js:368`), and
// that file's `handleKeyDown` fires `onSubmitEditing` on Enter without consulting
// `readOnly` or `editable` — so only an early return inside the handler stops a
// held return key there.
//
// Held return on `app/recover.tsx` spends the whole email-keyed
// `passwordResetRequestLimiter` budget (`server/routes.ts`) in a second, locking
// the person out of the reset they were asking for.
//
// Both counts are pinned, and each shape is matched whole rather than mined for
// identifiers. A scan that harvests `!(\w+)` out of an expression it never parsed
// reads `editable={!loading || true}` as guarded, and one that compares name sets
// reads `if (loading && !loading) return;` as a guard — each is a green run over
// the defect itself. Every expression here must therefore be one of the two
// shapes spelled out below, and an unfamiliar one is a red run to be read by a
// person, not a silent exclusion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, jsxTags, scannedFiles } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `editable={!a && !b}` whole, so `!loading || true` is not read as `!loading`. */
const NEGATED_FLAGS = /^!\w+(?:\s*&&\s*!\w+)*$/;

/** `if (a || b) return;` whole, so `loading && !loading` is not read as `loading`. */
const BUSY_FLAGS = /^\w+(?:\s*\|\|\s*\w+)*$/;

const flagsIn = (expression: string): Set<string> => new Set(expression.match(/\w+/g) ?? []);

/**
 * An `onSubmitEditing` that only moves focus issues no request and needs no
 * guard — `app/auth.tsx` steps to the next field that way. Ending in `.focus()`
 * cannot be the whole test: `() => submitRequest() || ref.current?.focus()` does
 * too, and would drop a real submitter out of the scan. So the body must call
 * nothing but `.focus()`.
 */
const movesFocusOnly = (expression: string): boolean => {
  const body = /^\(\)\s*=>\s*([^;]*\.focus\(\))$/.exec(expression)?.[1];
  return body !== undefined && !/\w+\s*\(/.test(body.replaceAll(".focus()", ""));
};

/** The `onSubmitEditing={…}` expression of a tag, braces balanced, or null. */
const submitExpression = (tag: string): string | null => {
  const open = tag.indexOf("{", tag.indexOf("onSubmitEditing="));
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(open + 1, i).trim();
  }
  return null;
};

/**
 * Every declaration of `handler`, as the condition of its first statement when
 * that statement is `if (…) return`, else null for that one.
 *
 * All of them, because `app/profile.tsx` declares `submit` twice, in two
 * components. Reading only the first match validates one component's input
 * against the other's body, and the unread guard can then be deleted green.
 */
const firstGuards = (source: string, handler: string): (string | null)[] =>
  [...source.matchAll(new RegExp(`function ${handler}\\s*\\([^)]*\\)\\s*\\{`, "g"))].map(
    (decl) => /^\s*if \(([^)]*)\) return;/.exec(source.slice(decl.index + decl[0].length))?.[1] ?? null,
  );

type Handler = { file: string; source: string; expression: string; tag: string };

/** Every `onSubmitEditing` in the two rendered trees, focus-movers included. */
const handlers: Handler[] = scannedFiles(repoRoot).flatMap((file) => {
  const source = blankComments(readFileSync(path.join(repoRoot, file), "utf8"));
  return jsxTags(source)
    .filter((tag) => !tag.isClose && tag.text.includes("onSubmitEditing="))
    .map((tag) => ({ file, source, expression: submitExpression(tag.text) ?? "", tag: tag.text }));
});

const submitters = handlers.filter(({ expression }) => !movesFocusOnly(expression));

test("every return-key handler is found, and which ones submit", () => {
  // Both counts, because only the pair is a fact about the tree. The total alone
  // lets a submitter be reshaped into something read as a focus-mover; the
  // submitter count alone lets that same swap be paid for by promoting one of
  // auth's two focus-movers. Moving an input between the categories has to move
  // a number here, where a person reads why.
  assert.equal(handlers.length, 10, `found ${handlers.length} onSubmitEditing props, expected 10`);
  assert.equal(submitters.length, 8, `found ${submitters.length} of them submitting, expected 8`);
});

test("a return-key submit names its handler", () => {
  for (const { file, expression } of submitters) {
    assert.match(
      expression,
      /^\w+$/,
      `${file}: onSubmitEditing={${expression}} neither names a handler nor moves focus and nothing else — the guard below cannot be checked through it`,
    );
  }
});

test("a return-key submit declares editable against its screen's busy flags", () => {
  for (const { file, expression, tag } of submitters) {
    const editable = /editable=\{([^}]*)\}/.exec(tag)?.[1]?.trim();
    assert.ok(
      editable !== undefined,
      `${file}: onSubmitEditing={${expression}} has no editable prop — a held return key repeats it on native`,
    );
    assert.match(
      editable,
      NEGATED_FLAGS,
      `${file}: editable={${editable}} is not \`!flag\` or \`!flag && !flag\`, so what it disables in flight cannot be read off it`,
    );
  }
});

test("a return-key submit's handler returns early on exactly those flags", () => {
  for (const { file, source, expression, tag } of submitters) {
    const flags = flagsIn(/editable=\{([^}]*)\}/.exec(tag)![1]);
    const guards = firstGuards(source, expression);
    assert.ok(guards.length > 0, `${file}: no \`function ${expression}\` to check the guard of`);
    for (const guard of guards) {
      assert.ok(
        guard,
        `${file}: ${expression}() does not open with \`if (…) return;\` — editable is readOnly on web, which does not stop onSubmitEditing`,
      );
      assert.match(
        guard,
        BUSY_FLAGS,
        `${file}: ${expression}()'s \`if (${guard}) return;\` is not \`flag\` or \`flag || flag\`, so whether it returns while busy cannot be read off it`,
      );
      // Both directions: a flag the prop negates and the handler ignores leaves
      // the web hole open, and a flag the handler guards and the prop no longer
      // negates is verify-email's `resending` half deleted with nothing red.
      assert.deepEqual(
        flagsIn(guard),
        flags,
        `${file}: ${expression}()'s guard and its editable prop name different busy flags`,
      );
    }
  }
});
