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
// Fail-closed by construction: anything this scan cannot read as a focus-mover
// has to name a handler it can check. A shape it does not understand is a red
// run, never a silent pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, jsxTags, scannedFiles } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * An `onSubmitEditing` whose whole body is a `.focus()` call issues no request —
 * `app/auth.tsx` moves to the next field that way. Ending in the call is the
 * whole test: `() => submit()` does not, and is read as a submitter it cannot
 * name, which reds.
 */
const MOVES_FOCUS = /^\(\)\s*=>\s*[^;]*\.focus\(\)$/;

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

/** The busy flags an `editable={!a && !b}` expression negates. */
const negatedFlags = (tag: string): Set<string> => {
  const editable = /editable=\{([^}]*)\}/.exec(tag);
  return new Set(editable ? [...editable[1].matchAll(/!(\w+)/g)].map((m) => m[1]) : []);
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

type Submitter = { file: string; source: string; expression: string; tag: string };

const submitters: Submitter[] = scannedFiles(repoRoot).flatMap((file) => {
  const source = blankComments(readFileSync(path.join(repoRoot, file), "utf8"));
  return jsxTags(source)
    .filter((tag) => !tag.isClose && tag.text.includes("onSubmitEditing="))
    .map((tag) => ({ file, source, expression: submitExpression(tag.text) ?? "", tag: tag.text }))
    .filter(({ expression }) => !MOVES_FOCUS.test(expression));
});

test("every return-key submit is found", () => {
  // The count that says the scan looked. A submitter deleted or reshaped into
  // something the scan reads as a focus-mover has to move this line with it.
  assert.equal(submitters.length, 8, `found ${submitters.length} submitting onSubmitEditing, expected 8`);
});

test("a return-key submit names its handler", () => {
  for (const { file, expression } of submitters) {
    assert.match(
      expression,
      /^\w+$/,
      `${file}: onSubmitEditing={${expression}} neither names a handler nor is a bare .focus() move — the guard below cannot be checked through it`,
    );
  }
});

test("a return-key submit declares editable against its screen's busy flags", () => {
  for (const { file, expression, tag } of submitters) {
    assert.ok(
      negatedFlags(tag).size > 0,
      `${file}: onSubmitEditing={${expression}} has no editable={!busyFlag} — a held return key repeats it on native`,
    );
  }
});

test("a return-key submit's handler returns early on exactly those flags", () => {
  for (const { file, source, expression, tag } of submitters) {
    const flags = negatedFlags(tag);
    const guards = firstGuards(source, expression);
    assert.ok(guards.length > 0, `${file}: no \`function ${expression}\` to check the guard of`);
    for (const guard of guards) {
      assert.ok(
        guard,
        `${file}: ${expression}() does not open with \`if (…) return;\` — editable is readOnly on web, which does not stop onSubmitEditing`,
      );
      // Both directions: a flag the prop negates and the handler ignores leaves
      // the web hole open, and a flag the handler guards and the prop no longer
      // negates is verify-email's `resending` half deleted with nothing red.
      assert.deepEqual(
        new Set(guard.match(/\b[a-z]\w*\b/gi) ?? []),
        flags,
        `${file}: ${expression}()'s guard and its editable prop name different busy flags`,
      );
    }
  }
});
