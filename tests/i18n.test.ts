// Localization layer tests (lib/i18n.ts, locales/{it,en,sq}.ts).
//
// This is what stops a future string being added to one locale only: the
// type system already forces locales/it.ts and locales/sq.ts to declare the
// exact key set of locales/en.ts (see the `Record<keyof typeof en, string>`
// annotation on each), but that only catches a *missing* key, not a stray
// runtime mismatch, an empty translation, or an interpolation placeholder
// that no longer matches across locales — hence these tests.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
// @ts-ignore — see tests/helpers.ts for why the .ts extension is required
import { it } from "../locales/it.ts";
// @ts-ignore
import { en } from "../locales/en.ts";
// @ts-ignore
import { sq } from "../locales/sq.ts";
// @ts-ignore
import { translate, interpolate, DEFAULT_LOCALE } from "../lib/i18n.ts";

const LOCALES = { it, en, sq } as const;
type LocaleName = keyof typeof LOCALES;
const LOCALE_NAMES = Object.keys(LOCALES) as LocaleName[];

describe("locale key parity", () => {
  const enKeys = Object.keys(en).sort();

  for (const name of LOCALE_NAMES) {
    test(`${name} has exactly the same key set as en (the source of truth)`, () => {
      const keys = Object.keys(LOCALES[name]).sort();
      assert.deepEqual(
        keys,
        enKeys,
        `${name} key set diverges from locales/en.ts`
      );
    });
  }

  test("every locale has the same number of keys", () => {
    const counts = LOCALE_NAMES.map((name) => Object.keys(LOCALES[name]).length);
    assert.ok(
      counts.every((c) => c === counts[0]),
      `key counts differ: ${LOCALE_NAMES.map((n, i) => `${n}=${counts[i]}`).join(", ")}`
    );
  });

  // Shown to the whole table several times a hand, so a form that assumes the
  // player's gender misgenders someone on most hands. Italian and Albanian both
  // inflect these; English does not.
  test("no server.* string assumes the player's gender", () => {
    const GENDERED = {
      it: /\b(inattivo|inattiva|disconnesso|disconnessa|rientrato|rientrata|connesso|connessa)\b/i,
      sq: /\b(joaktiv|joaktive|shkëputur|kthyer)\b/i,
    } as const;

    for (const [name, pattern] of Object.entries(GENDERED)) {
      const catalogue = LOCALES[name as LocaleName] as Record<string, string>;
      const offenders = Object.entries(catalogue)
        .filter(([key]) => key.startsWith("server."))
        .filter(([, value]) => pattern.test(value))
        .map(([key]) => key);
      assert.deepEqual(
        offenders,
        [],
        `${name}: these assume a gender — ${offenders.join(", ")}`
      );
    }
  });
});

describe("no empty translations", () => {
  for (const name of LOCALE_NAMES) {
    test(`${name} has no key with an empty string value`, () => {
      const empty = Object.entries(LOCALES[name]).filter(([, v]) => v === "");
      assert.deepEqual(
        empty.map(([k]) => k),
        [],
        `${name} has empty-string translations for these keys`
      );
    });
  }
});

describe("pluralisation pairs", () => {
  test("every _one key has a matching _other key and vice versa, in every locale", () => {
    for (const name of LOCALE_NAMES) {
      const keys = new Set(Object.keys(LOCALES[name]));
      for (const key of keys) {
        if (key.endsWith("_one")) {
          const base = key.slice(0, -"_one".length);
          assert.ok(
            keys.has(`${base}_other`),
            `${name}: "${key}" has no matching "${base}_other"`
          );
        }
        if (key.endsWith("_other")) {
          const base = key.slice(0, -"_other".length);
          assert.ok(
            keys.has(`${base}_one`),
            `${name}: "${key}" has no matching "${base}_one"`
          );
        }
      }
    }
  });
});

describe("interpolation placeholders stay in sync across locales", () => {
  function placeholders(template: string): string[] {
    return [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  }

  test("every locale uses the same {{placeholder}} names as en for a given key", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const expected = placeholders(en[key]);
      if (expected.length === 0) continue;
      for (const name of LOCALE_NAMES) {
        const actual = placeholders(LOCALES[name][key]);
        assert.deepEqual(
          actual,
          expected,
          `${name}["${key}"] placeholders ${JSON.stringify(actual)} != en's ${JSON.stringify(expected)}`
        );
      }
    }
  });
});

describe("interpolate()", () => {
  test("replaces a single placeholder", () => {
    assert.equal(interpolate("Hello {{name}}", { name: "Ana" }), "Hello Ana");
  });

  test("replaces multiple distinct placeholders", () => {
    assert.equal(
      interpolate("{{a}}/{{b}}", { a: 1, b: 2 }),
      "1/2"
    );
  });

  test("replaces every occurrence of a repeated placeholder", () => {
    assert.equal(
      interpolate("{{x}} and {{x}} again", { x: "3" }),
      "3 and 3 again"
    );
  });

  test("leaves a placeholder untouched when its param is missing", () => {
    assert.equal(interpolate("Hi {{name}}", {}), "Hi {{name}}");
  });

  test("returns the template unchanged when no params are given", () => {
    assert.equal(interpolate("plain text"), "plain text");
  });
});

describe("translate() produces the expected output per locale", () => {
  // The two halves of "a missing key renders English": translate() resolves a
  // gap through DEFAULT_LOCALE, and en.ts is the catalogue the other two are
  // typed against — so a key can only be missing from it.ts or sq.ts.
  test("English is the fallback catalogue and the key set every locale derives from", () => {
    assert.equal(DEFAULT_LOCALE, "en");

    const localeDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "locales"
    );
    for (const name of ["it", "sq"]) {
      const src = readFileSync(path.join(localeDir, `${name}.ts`), "utf8");
      assert.match(
        src,
        new RegExp(`export const ${name}: Record<keyof typeof en, string>`),
        `locales/${name}.ts must derive its key set from en`
      );
    }
    assert.equal(
      /export const en\s*=/.test(readFileSync(path.join(localeDir, "en.ts"), "utf8")),
      true,
      "locales/en.ts must declare the key set itself, not derive it"
    );
  });

  test("simple key, no params, in every locale", () => {
    assert.equal(translate("it", "common.ok"), "OK");
    assert.equal(translate("en", "common.ok"), "OK");
    assert.equal(translate("sq", "common.ok"), "OK");
  });

  test("interpolated key substitutes the param in every locale", () => {
    assert.equal(
      translate("it", "friends.removeConfirmBody", { username: "Marco" }),
      "Vuoi rimuovere Marco dagli amici?"
    );
    assert.equal(
      translate("en", "friends.removeConfirmBody", { username: "Marco" }),
      "Do you want to remove Marco from your friends?"
    );
    assert.equal(
      translate("sq", "friends.removeConfirmBody", { username: "Marco" }),
      "Dëshiron ta heqësh Marco nga miqtë?"
    );
  });

  test("a key with two params interpolates both", () => {
    const out = translate("en", "room.modeAndPlayers", { mode: "Teams", n: 4 });
    assert.equal(out, "Teams · 4 players");
  });

  test("falls back to Italian (the default locale) for an unknown key at runtime", () => {
    // @ts-expect-error — deliberately an invalid key to exercise the fallback path
    const out = translate("en", "this.key.does.not.exist");
    assert.equal(out, "this.key.does.not.exist");
  });

  test("every error code the server can emit has a server.* key", () => {
    // The server is written in English and ships a stable `code` plus an
    // English fallback; the catalogues are the only place the player's
    // language comes from. A code with no key here falls through
    // `translateServerPayload` to that English fallback and shows an Italian
    // player English — which is how `REPLAY_NOT_FOUND` was found.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const emitted = new Set<string>();
    for (const rel of ["server/routes.ts", "server/socket.ts"]) {
      const source = readFileSync(path.join(repoRoot, rel), "utf8");
      for (const m of source.matchAll(/code: "([A-Z_]+)"/g)) emitted.add(m[1]);
      // seatClaimCode() and its siblings return the code directly.
      for (const m of source.matchAll(/return "([A-Z][A-Z_]{3,})";/g)) emitted.add(m[1]);
    }
    assert.ok(emitted.size > 10, `expected to find the server's codes, got ${emitted.size}`);

    const missing = [...emitted].filter(
      (code) => !Object.prototype.hasOwnProperty.call(en, `server.${code}`)
    );
    assert.deepEqual(
      missing,
      [],
      `these codes have no server.* translation: ${missing.join(", ")}`
    );
  });

  test("every game:rejoin_failed reason is renderable and distinct in every locale", () => {
    // The five emit sites are the only thing standing between the player and
    // a game that vanishes with no explanation, so they have to follow the
    // wire's { code, message } contract — `reason` is invisible to
    // translateServerPayload — and no two of them may render the same
    // sentence, or the codes carry no information.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const source = readFileSync(path.join(repoRoot, "server/socket.ts"), "utf8");
    const sites = source
      .split("\n")
      .filter((line) => line.includes('"game:rejoin_failed"'));
    assert.equal(sites.length, 5, "the rejoin handler has five failure exits");
    for (const site of sites) {
      assert.ok(site.includes("message:"), `not on the error contract: ${site.trim()}`);
      assert.ok(!site.includes("reason:"), `still ships reason: ${site.trim()}`);
      assert.ok(site.includes("roomId"), `no roomId for the client's guard: ${site.trim()}`);
    }

    const codes = new Set(
      sites.map((site) => /code: "([A-Z_]+)"/.exec(site)?.[1] ?? "")
    );
    assert.deepEqual(
      [...codes].sort(),
      ["GAME_NOT_FOUND", "GAME_NO_LONGER_VALID", "SERVER_ERROR", "UNAUTHORIZED"]
    );
    for (const locale of ["it", "en", "sq"] as const) {
      const rendered = [...codes].map((code) =>
        translate(locale, `server.${code}` as keyof typeof en)
      );
      assert.equal(
        new Set(rendered).size,
        codes.size,
        `${locale} renders two rejoin failures identically: ${rendered.join(" / ")}`
      );
    }
  });

  test("no server.* key is unused", () => {
    // The mirror of the test above: a key nothing can emit is dead weight
    // that three catalogues have to keep translating.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const serverDir = path.join(repoRoot, "server");
    const sources = readdirSync(serverDir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(path.join(serverDir, f), "utf8"))
      .join("\n");
    const unused = Object.keys(en)
      .filter((key) => key.startsWith("server."))
      .map((key) => key.slice("server.".length))
      .filter((code) => !sources.includes(`"${code}"`));
    assert.deepEqual(unused, [], `unused server.* keys: ${unused.join(", ")}`);
  });
});

describe("every player-facing server response carries a code", () => {
  // The test above enumerates codes the server emits and checks each is
  // translatable — it can only see a code that exists. A response with no
  // code at all is invisible to it, which is exactly how validate.ts and
  // socketSafety.ts leaked raw Italian to every locale. This scans response
  // and socket-emit payloads directly instead of known codes, so it catches
  // an absence.

  /** Span (end exclusive) of the `{...}` that opens at `braceStart`. */
  function braceSpan(source: string, braceStart: number): number {
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) {
        i++;
        break;
      }
    }
    return i;
  }

  /** Every `.json(` or `.emit(` call anywhere in `sourceFile`. */
  function responseCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "json" || node.expression.name.text === "emit")
      ) {
        calls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return calls;
  }

  /** An object literal's own top-level property names. */
  function propertyNames(obj: ts.ObjectLiteralExpression): Set<string> {
    const names = new Set<string>();
    for (const prop of obj.properties) {
      if (
        (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
      ) {
        names.add(prop.name.text);
      }
    }
    return names;
  }

  /** Every object literal argument of a `.json(`/`.emit(` call, at any position in the argument list. */
  function payloadObjects(
    sourceFile: ts.SourceFile
  ): { start: number; text: string; names: Set<string> }[] {
    const objects: { start: number; text: string; names: Set<string> }[] = [];
    for (const call of responseCalls(sourceFile)) {
      for (const arg of call.arguments) {
        if (ts.isObjectLiteralExpression(arg)) {
          objects.push({
            start: arg.getStart(sourceFile),
            text: arg.getText(sourceFile),
            names: propertyNames(arg),
          });
        }
      }
    }
    return objects;
  }

  /** Span of `name`'s function body, declared either way this codebase does it. */
  function functionBodySpan(source: string, name: string): [number, number] | null {
    const decl = new RegExp(
      `(?:function\\s+${name}\\s*\\([^{]*\\)|(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^{]*\\)\\s*(?::[^{=]+)?=>)\\s*\\{`
    );
    const m = decl.exec(source);
    if (!m) return null;
    const start = m.index + m[0].length - 1;
    return [start, braceSpan(source, start)];
  }

  /**
   * Spans reached only from behind an `expo-platform` header check.
   * `server/app.ts`'s `expoManifestHandler` gates `serveExpoManifest` on
   * that header; anything it calls inherits the same gate.
   */
  function headerGatedSpans(source: string): [number, number][] {
    const handler = functionBodySpan(source, "expoManifestHandler");
    if (!handler) return [];
    const [hStart, hEnd] = handler;
    const handlerBody = source.slice(hStart, hEnd);
    if (!handlerBody.includes("expo-platform")) return [];
    const spans: [number, number][] = [];
    for (const m of handlerBody.matchAll(/\b([a-zA-Z_$][\w$]*)\(/g)) {
      const callee = functionBodySpan(source, m[1]);
      if (callee) spans.push(callee);
    }
    return spans;
  }

  test("no player-facing JSON response or socket error emit omits a code", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const serverDir = path.join(repoRoot, "server");
    const files = readdirSync(serverDir, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".ts")
    );

    const violations: string[] = [];
    for (const file of files) {
      const filePath = path.join(serverDir, file);
      const source = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const exemptSpans = headerGatedSpans(source);
      for (const { start, text, names } of payloadObjects(sourceFile)) {
        if (!names.has("message") && !names.has("error")) continue;
        if (names.has("code")) continue;
        if (exemptSpans.some(([s, e]) => start >= s && start < e)) continue;
        violations.push(`${file}: ${text.replace(/\s+/g, " ").trim().slice(0, 90)}`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `these player-facing responses carry no code: ${violations.join(" | ")}`
    );
  });
});
