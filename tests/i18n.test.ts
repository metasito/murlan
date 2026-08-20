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
import { it } from "../locales/it.ts";
import { en } from "../locales/en.ts";
import { sq } from "../locales/sq.ts";
import { translate, interpolate, DEFAULT_LOCALE } from "../lib/i18n.ts";

const LOCALES = { it, en, sq } as const;
type LocaleName = keyof typeof LOCALES;
const LOCALE_NAMES = Object.keys(LOCALES) as LocaleName[];
/** en is the set every other locale is compared against, so it cannot diverge from itself. */
const TRANSLATED = LOCALE_NAMES.filter((name) => name !== "en");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");

function serverSources(): { file: string; source: string }[] {
  return readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((file) => ({ file, source: readFileSync(path.join(SERVER_DIR, file), "utf8") }));
}

/** The property names a payload puts a sentence in. */
const TEXT_FIELDS = new Set(["message", "error", "body", "reason"]);

/**
 * The text of every string and template literal below `node`, with `${expr}`
 * rendered as `{{expr}}` so the server's own sentences read like the
 * catalogues'. Stops at a nested call: its arguments are that call's payload.
 */
function literalsIn(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      found.push(n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      found.push(
        n.head.text +
          n.templateSpans
            .map((s) => `{{${s.expression.getText(sourceFile)}}}${s.literal.text}`)
            .join("")
      );
      return;
    }
    if (ts.isCallExpression(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Every sentence the server puts in a payload's text field. */
function payloadSentences(sourceFile: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      TEXT_FIELDS.has(node.name.text)
    ) {
      found.push(...literalsIn(node.initializer, sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("locale key parity", () => {
  const enKeys = Object.keys(en).sort();

  for (const name of TRANSLATED) {
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
});

describe("no server string assumes the player's gender", () => {
  // A server.* string names one player and is shown to the whole table several
  // times a hand, so a form that agrees with that player's gender misgenders
  // someone on most hands. Italian and Albanian both inflect; English does not,
  // which is why en.ts reads as the neutral original and the translations —
  // and the server's own English fallbacks — are where the assumption creeps in.
  //
  // Matching is by frame, not by vocabulary. The same endings agree with an
  // object all over both catalogues (`carta scambiata`, `questa sessione è
  // stata chiusa`, `Lëvizje e pavlefshme`), so only a marker in a position that
  // can refer to a person counts. Italian possessives are deliberately absent:
  // `suo` agrees with the thing possessed, so `il suo posto` says nothing about
  // whose seat it is — Albanian `tij`/`saj` agrees with the possessor and says
  // everything.

  /** Italian participle and adjective endings that carry gender. */
  const AGREEING = String.raw`\w*(?:at|it|ut|st|ss|tt|nt|iv|ur|or)[oa]\b`;

  const PATTERNS: Record<"it" | "sq", [string, RegExp][]> = {
    it: [
      ["predicated of the addressee", new RegExp(String.raw`\b(?:sei|siete)\s+(?:non\s+)?(?:stat[oa]\s+)?${AGREEING}`, "i")],
      ["predicated of the named player", new RegExp(String.raw`\{\{username\}\}\s+(?:non\s+)?(?:si\s+)?(?:è|era|sarà)\s+(?:stat[oa]\s+)?${AGREEING}`, "i")],
      ["a bare participle, so about the reader", new RegExp(String.raw`^Non\s+${AGREEING}`, "i")],
      ["reflexive", /\b(?:me|te|se|sé)\s+stess[oaie]\b/i],
      ["third-person pronoun", /\b(?:lui|lei|esso|essa)\b/i],
    ],
    sq: [
      ["possessive, which agrees with the possessor", /\b(?:tij|saj)\b/i],
      ["adjectival article after the copula", /\bje(?:ni)?\s+[ie]\b/i],
      ["a leading adjectival article, so about the reader", /^(?:I|E)\s+\w/],
      ["third-person pronoun", /\b(?:ai|ajo)\b/i],
    ],
  };

  function offences(text: string, patterns: [string, RegExp][]): string[] {
    return patterns.filter(([, re]) => re.test(text)).map(([label]) => label);
  }

  for (const name of ["it", "sq"] as const) {
    test(`${name}'s server.* strings are neutral`, () => {
      const catalogue = LOCALES[name] as Record<string, string>;
      const offenders = Object.entries(catalogue)
        .filter(([key]) => key.startsWith("server."))
        .flatMap(([key, value]) =>
          offences(value, PATTERNS[name]).map((label) => `${key} (${label}): ${value}`)
        );
      assert.deepEqual(offenders, [], `${name}: ${offenders.join(" | ")}`);
    });
  }

  // The catalogues were de-gendered once already while the same four sentences
  // stayed masculine in server/, where the guard could not see them — and the
  // fallback is exactly what a client too old to know the code renders.
  test("the server's own fallback sentences are neutral", () => {
    const all = [...PATTERNS.it, ...PATTERNS.sq];
    const offenders: string[] = [];
    let sentenceCount = 0;
    for (const { file, source } of serverSources()) {
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const text of payloadSentences(sourceFile)) {
        sentenceCount++;
        for (const label of offences(text, all)) {
          offenders.push(`${file} (${label}): ${text}`);
        }
      }
    }
    assert.ok(
      sentenceCount > 100,
      `expected server/'s payload sentences, got ${sentenceCount} (106 when this floor was set)`
    );
    assert.deepEqual(offenders, [], offenders.join(" | "));
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
    const pairs = Object.keys(en).filter((k) => k.endsWith("_one")).length;
    assert.ok(pairs >= 8, `expected en's plural keys, got ${pairs} (8 when this floor was set)`);

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

  // Both directions: a translation that drops en's placeholder renders a raw
  // `{{username}}`, and one that invents a placeholder en does not have renders
  // it too, because no call site passes a param nobody asked for.
  test("every locale uses the same {{placeholder}} names as en for a given key", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const expected = placeholders(en[key]);
      for (const name of TRANSLATED) {
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

  test("renders an unknown key as itself rather than blank", () => {
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
    const emitted = new Set<string>();
    for (const { source } of serverSources()) {
      for (const m of source.matchAll(/code: "([A-Z_]+)"/g)) emitted.add(m[1]);
      // seatClaimCode() and its siblings return the code directly.
      for (const m of source.matchAll(/return "([A-Z][A-Z_]{3,})";/g)) emitted.add(m[1]);
    }
    assert.ok(
      emitted.size > 44,
      `expected to find the server's codes, got ${emitted.size} (46 when this floor was set)`
    );

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
    const source = readFileSync(path.join(SERVER_DIR, "socket.ts"), "utf8");
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
    const sources = serverSources()
      .map(({ source }) => source)
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

  /**
   * Anything that hands a payload to a player: the response and socket
   * primitives, and the helpers that wrap them. `notifyUser` is why the list
   * is not just `json`/`emit` — a push body reaches a lock screen with no
   * client in the loop, so it is the payload that can least afford to be
   * unreadable, and it is invisible to a scan that only knows method calls.
   */
  const DELIVERS_TO_A_PLAYER = new Set(["json", "emit", "notifyUser", "emitToUser"]);

  /** Every call that delivers a payload to a player, anywhere in `sourceFile`. */
  function responseCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : ts.isIdentifier(node.expression)
            ? node.expression.text
            : null;
        if (callee && DELIVERS_TO_A_PLAYER.has(callee)) calls.push(node);
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

  /**
   * Every `ObjectLiteralExpression` reachable from `node` without crossing
   * into a nested call's own arguments — so `a ? {x} : {y}`, `a ?? {x}`,
   * `{x} as T` and any other wrapper report the object literals inside them,
   * while `helper({x})` reports none: that one belongs to `helper`.
   */
  function objectLiteralsIn(node: ts.Node): ts.ObjectLiteralExpression[] {
    const found: ts.ObjectLiteralExpression[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        found.push(n);
        return;
      }
      if (ts.isCallExpression(n)) return;
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  /** Every object literal reachable from a delivering call's arguments, at any position and depth. */
  function payloadObjects(sourceFile: ts.SourceFile): { text: string; names: Set<string> }[] {
    const objects: { text: string; names: Set<string> }[] = [];
    for (const call of responseCalls(sourceFile)) {
      for (const arg of call.arguments) {
        for (const obj of objectLiteralsIn(arg)) {
          objects.push({
            text: obj.getText(sourceFile),
            names: propertyNames(obj),
          });
        }
      }
    }
    return objects;
  }

  test("no player-facing JSON response or socket error emit omits a code", () => {
    const files = serverSources();
    assert.ok(
      files.length >= 28,
      `expected to find server/'s .ts files, got ${files.length} (29 when this floor was set)`
    );

    const violations: string[] = [];
    let objectCount = 0;
    for (const { file, source } of files) {
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const objects = payloadObjects(sourceFile);
      objectCount += objects.length;
      for (const { text, names } of objects) {
        if (![...TEXT_FIELDS].some((field) => names.has(field))) continue;
        if (names.has("code")) continue;
        violations.push(`${file}: ${text.replace(/\s+/g, " ").trim().slice(0, 90)}`);
      }
    }
    assert.ok(
      objectCount > 102,
      `expected to find the server's response payload objects, got ${objectCount} (104 when this floor was set)`
    );
    assert.deepEqual(
      violations,
      [],
      `these player-facing responses carry no code: ${violations.join(" | ")}`
    );
  });
});
