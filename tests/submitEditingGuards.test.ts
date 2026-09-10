// tests/submitEditingGuards.test.ts — an input that submits on the return key
// needs both halves of the in-flight guard, and each half covers a platform the
// other misses.
//
// `editable={false}` is what iOS and Android honour: a non-editable field takes
// no keystroke, so auto-repeat cannot reach the handler. On web it becomes
// `readOnly` (react-native-web `exports/TextInput/index.js`), and that file's
// `handleKeyDown` fires `onSubmitEditing` on Enter without consulting `readOnly`
// or `editable` — a readOnly input still focuses and still receives keydown. Only
// an early return inside the handler stops a held return key there.
//
// Held return on `app/recover.tsx` spends the whole email-keyed
// `passwordResetRequestLimiter` budget (`server/routes.ts`) in a second, locking
// the person out of the reset they were asking for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, jsxTags, scannedFiles } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A bare identifier only. `onSubmitEditing={() => pwdRef.current?.focus()}` moves
 * focus and issues nothing, so it needs no guard and must not be reported.
 */
const SUBMITTING = /onSubmitEditing=\{(\w+)\}/;

/** The busy flags an `editable={!a && !b}` expression negates, in source order. */
const negatedFlags = (tag: string): string[] => {
  const editable = /editable=\{([^}]*)\}/.exec(tag);
  return editable ? [...editable[1].matchAll(/!(\w+)/g)].map((m) => m[1]) : [];
};

/** The condition of the handler's first statement, when that statement is `if (…) return`. */
const firstGuard = (source: string, handler: string): string | null => {
  const decl = new RegExp(`function ${handler}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!decl) return null;
  const body = source.slice(decl.index + decl[0].length);
  return /^\s*if \(([^)]*)\) return;/.exec(body)?.[1] ?? null;
};

type Submitter = { file: string; handler: string; tag: string };

const submitters: Submitter[] = scannedFiles(repoRoot).flatMap((file) => {
  const source = blankComments(readFileSync(path.join(repoRoot, file), "utf8"));
  return jsxTags(source)
    .filter((tag) => !tag.isClose && SUBMITTING.test(tag.text))
    .map((tag) => ({ file, handler: SUBMITTING.exec(tag.text)![1], tag: tag.text }));
});

test("every return-key submit is found", () => {
  // A scan over zero nodes passes. This is the count that says it looked.
  assert.ok(submitters.length >= 7, `found only ${submitters.length} submitting onSubmitEditing`);
});

test("a return-key submit declares editable against its screen's busy flags", () => {
  for (const { file, handler, tag } of submitters) {
    assert.ok(
      negatedFlags(tag).length > 0,
      `${file}: onSubmitEditing={${handler}} has no editable={!busyFlag} — a held return key repeats it on native`,
    );
  }
});

test("a return-key submit's handler returns early on the same flags", () => {
  for (const { file, handler, tag } of submitters) {
    const source = blankComments(readFileSync(path.join(repoRoot, file), "utf8"));
    const guard = firstGuard(source, handler);
    assert.ok(
      guard,
      `${file}: ${handler}() does not open with \`if (…) return;\` — editable is readOnly on web, which does not stop onSubmitEditing`,
    );
    for (const flag of negatedFlags(tag)) {
      assert.match(
        guard,
        new RegExp(`\\b${flag}\\b`),
        `${file}: ${handler}()'s guard ignores \`${flag}\`, which its own editable prop negates`,
      );
    }
  }
});
