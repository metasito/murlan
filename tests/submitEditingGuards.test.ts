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
// Every expression below is matched as a whole shape, never mined for the
// identifiers in it, and the flag both halves name has to be one the handler
// raises before it awaits. An expression in a shape this file does not spell out
// is a red run for a person to read.
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
 * cannot be the whole test: `() => submitRequest?.() || ref.current?.focus()`
 * does too, and would drop a real submitter out of the scan. So the body must
 * call nothing but `.focus()`, and a call is anything a `(` can follow.
 */
const movesFocusOnly = (expression: string): boolean => {
  const body = /^\(\)\s*=>\s*([^;]*\.focus\(\))$/.exec(expression)?.[1];
  return body !== undefined && !/[\w?.\])]\s*\(/.test(body.replaceAll(".focus()", ""));
};

/** The value of `prop` on a tag, braces balanced, or null. */
const propExpression = (tag: string, prop: string): string | null => {
  const at = tag.indexOf(`${prop}=`);
  if (at === -1) return null;
  const open = tag.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(open + 1, i).trim();
  }
  return null;
};

/**
 * The body of every declaration of `handler`, braces balanced.
 *
 * All of them, because `app/profile.tsx` declares `submit` twice, in two
 * components. Reading only the first match validates one component's input
 * against the other's body, and the unread guard can then be deleted green.
 */
const bodies = (source: string, handler: string): string[] =>
  [...source.matchAll(new RegExp(`function ${handler}\\s*\\([^)]*\\)\\s*\\{`, "g"))].map((decl) => {
    const open = decl.index + decl[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
    }
    return source.slice(open + 1);
  });

/** The condition of a body's first statement, when that statement is `if (…) return`. */
const openingGuard = (body: string): string | null => /^\s*if \(([^)]*)\) return;/.exec(body)?.[1] ?? null;

/** Whether `body` calls `setFlag(true)` before it awaits anything. */
const raisedBeforeAwait = (body: string, flag: string): boolean => {
  const raised = body.search(new RegExp(`set${flag[0].toUpperCase()}${flag.slice(1)}\\(true\\)`));
  const awaited = body.search(/\bawait\b/);
  return raised !== -1 && (awaited === -1 || raised < awaited);
};

type Handler = {
  file: string;
  source: string;
  expression: string;
  editable: string | null;
  /** A `{...props}` written after `editable`, which last-wins would overwrite. */
  spreads: boolean;
};

/** Every `onSubmitEditing` in the two rendered trees, focus-movers included. */
const handlers: Handler[] = scannedFiles(repoRoot).flatMap((file) => {
  const source = blankComments(readFileSync(path.join(repoRoot, file), "utf8"));
  return jsxTags(source)
    .filter((tag) => !tag.isClose && tag.text.includes("onSubmitEditing="))
    .map((tag) => ({
      file,
      source,
      expression: propExpression(tag.text, "onSubmitEditing") ?? "",
      editable: propExpression(tag.text, "editable"),
      spreads: tag.text.lastIndexOf("{...") > tag.text.indexOf("editable="),
    }));
});

const submitters = handlers.filter(({ expression }) => !movesFocusOnly(expression));

test("every return-key handler is found, and which ones submit", () => {
  // Both counts: either alone lets an input be moved between the categories,
  // which is how a submitter reshaped into something read as a focus-mover pays
  // for itself. Moving one has to move a number here, where a person reads why.
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
  for (const { file, expression, editable, spreads } of submitters) {
    assert.ok(
      editable !== null,
      `${file}: onSubmitEditing={${expression}} has no editable prop — a held return key repeats it on native`,
    );
    assert.match(
      editable,
      NEGATED_FLAGS,
      `${file}: editable={${editable}} is not \`!flag\` or \`!flag && !flag\`, so what it disables in flight cannot be read off it`,
    );
    // JSX is last-wins and this scan cannot see inside a spread — the blind spot
    // CLAUDE.md records for icon names. Writing `editable` after every spread is
    // what makes it unoverwritable, rather than the scan having to prove a
    // negative about what the spread holds.
    assert.ok(
      !spreads,
      `${file}: onSubmitEditing={${expression}} has a {...spread} written after editable, which would overwrite it`,
    );
  }
});

test("a return-key submit's handler returns early on exactly those flags", () => {
  for (const { file, source, expression, editable } of submitters) {
    const flags = flagsIn(editable ?? "");
    const found = bodies(source, expression);
    assert.ok(found.length > 0, `${file}: no \`function ${expression}\` to check the guard of`);
    for (const body of found) {
      const guard = openingGuard(body);
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
      // Agreeing on a flag is not enough: a flag this handler only raises after
      // the request, or never, is false for the whole in-flight window and both
      // halves guard nothing.
      assert.ok(
        [...flags].some((flag) => raisedBeforeAwait(body, flag)),
        `${file}: ${expression}() awaits without first calling set…(true) on any of ${[...flags].join(", ")} — the guard is never true while the request is in flight`,
      );
    }
  }
});
