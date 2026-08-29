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
import { CARD_BACK_IDS, TABLE_FELT_IDS } from "../lib/cosmetics.ts";
import { BOT_PERSONALITIES } from "../lib/botPersonalities.ts";

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

/**
 * The property names a payload puts a sentence in. The last two are zod's: a
 * schema states its own refusal text there, and `unpackPersistedState`
 * (server/onlineGameLogic.ts) hands the first complaint back as a `reason`, so
 * a schema is a payload's wording however far it sits from the payload.
 */
const TEXT_FIELDS = new Set([
  "message",
  "error",
  "body",
  "reason",
  "required_error",
  "invalid_type_error",
]);

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

/**
 * Whether an expression is rooted at the zod namespace, so `z.string()` and
 * `z.number().int()` both answer yes and a same-named method on anything else
 * answers no.
 */
function isZodChain(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isCallExpression(current)) current = current.expression;
    else if (ts.isPropertyAccessExpression(current)) current = current.expression;
    else return ts.isIdentifier(current) && current.text === "z";
  }
}

/**
 * Every sentence the server puts in a payload's text field.
 *
 * A zod validator takes its refusal text as a trailing argument rather than a
 * named property — `.int("no deal rotation")`, `.min(1, "no join code")` — so
 * the field names above cannot reach it and `literalsIn` stops at the call.
 * Scoping it to a `z.` chain is what keeps `t("some.key")` out.
 */
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
    if (ts.isCallExpression(node) && isZodChain(node.expression)) {
      const last = node.arguments[node.arguments.length - 1];
      if (last && (ts.isStringLiteral(last) || ts.isNoSubstitutionTemplateLiteral(last))) {
        found.push(last.text);
      }
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
      ["a gendered adjective predicated of the named player", /\{\{name\}\}\s+(?!ha\b|hanno\b|hai\b|ho\b|avete\b|abbiamo\b)\w+\s+\w+[oa](?=[.!?\n]|$)/i],
    ],
    sq: [
      ["possessive, which agrees with the possessor", /\b(?:tij|saj)\b/i],
      ["adjectival article after the copula", /\bje(?:ni)?\s+[ie]\b/i],
      ["a leading adjectival article, so about the reader", /^(?:I|E)\s+\w/],
      ["third-person pronoun", /\b(?:ai|ajo)\b/i],
      ["an adjectival article predicated of the named player", /\{\{name\}\}\s+\w+\s+[ie]\s+\w/i],
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


  // The same frames reach the player outside server.*: a client string that
  // interpolates a username predicates on it just as readily, and a username
  // carries no gender for it to agree with.
  const NAMES_A_PLAYER = /\{\{(?:name|username|from|to|winner|loser|player)\}\}/;

  for (const name of ["it", "sq"] as const) {
    test(`${name}'s client strings that name a player are neutral`, () => {
      const named = Object.entries(LOCALES[name] as Record<string, string>).filter(
        ([key, value]) => !key.startsWith("server.") && NAMES_A_PLAYER.test(value)
      );
      assert.ok(named.length > 25, `expected the client strings that name a player, got ${named.length}`);
      const offenders = named.flatMap(([key, value]) =>
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
    const sentences: string[] = [];
    for (const { file, source } of serverSources()) {
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const text of payloadSentences(sourceFile)) {
        sentences.push(text);
        for (const label of offences(text, all)) {
          offenders.push(`${file} (${label}): ${text}`);
        }
      }
    }
    // The scan's own floor, and why it is a sentence and not only a number:
    // this one exists nowhere but a schema's option key, so a scan that stops
    // descending schemas fails here outright instead of merely counting lower,
    // which is a thing that can be answered by lowering the count.
    assert.ok(
      sentences.includes("no join code"),
      "the scan no longer reaches a schema's own refusal text (server/onlineGameLogic.ts) — " +
        "if that sentence was reworded, name the new one here rather than dropping the check"
    );
    // A floor of its own for the trailing-argument half of the scan
    // (isZodChain): "no join code" above exists as a required_error /
    // invalid_type_error property too, so it stayed true even with the whole
    // isZodChain branch deleted — it was never really testing this half.
    // "Invalid room code" (server/socketSchemas.ts) has no options object on
    // that field at all, so it is reachable only through the trailing-argument
    // path.
    assert.ok(
      sentences.includes("Invalid room code"),
      "the scan no longer reaches a validator's own trailing message " +
        "(server/socketSchemas.ts) — if that sentence was reworded, name the new one here"
    );
    assert.ok(
      sentences.length > 120,
      `expected server/'s payload sentences, got ${sentences.length} (127 when this floor was set)`
    );
    assert.deepEqual(offenders, [], offenders.join(" | "));
  });
});

// `locales/en.ts` is the source of truth, and a payload's own sentence is the
// fallback a client too old to know the code renders. Three of them shipped
// Italian prose, so an English or Albanian player read Italian for want of a
// key that already existed — the code and the params were being sent all
// along, only the fallback was written out by hand in the wrong language.
describe("the server writes its fallbacks in the source language", () => {
  // Words that cannot be an English sentence and are not a proper noun. Short
  // ones like `la` and `non` are deliberately absent: `non-null` and `a la`
  // would answer for them. That narrowness is the trade: this catches the
  // vocabulary that shipped, not Italian in general, so a fresh sentence
  // reaching for different words is past it.
  const ITALIAN =
    /\b(?:devi|deve|giocare|lasciato|partita|valido|valida|eliminazione|codice|carta|prima|della|dello|questa|questo|posto|solo|lettere|numeri|utente|nome|scegli|inserisci|riprova|errore|impossibile|almeno|troppo|essere|sono|hanno|degli|delle)\b/i;

  test("the marker list can see an Italian sentence", () => {
    // Without this the assertion below would also hold on a list that matches
    // nothing at all.
    assert.ok(ITALIAN.test("Devi giocare il 3♠ come prima carta"));
    assert.ok(ITALIAN.test("{{username}} ha lasciato la partita."));
    // The one the first sweep's shorter list walked straight past.
    assert.ok(ITALIAN.test("Solo lettere, numeri e underscore"));
    assert.ok(!ITALIAN.test("You must play the {{rank}}♠ as your first card"));
    assert.ok(!ITALIAN.test("Deletion failed"));
  });

  test("no payload sentence under server/ is written in Italian", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const { file, source } of serverSources()) {
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const text of payloadSentences(sourceFile)) {
        scanned++;
        if (ITALIAN.test(text)) offenders.push(`${file}: ${text}`);
      }
    }
    assert.ok(scanned > 120, `expected server/'s payload sentences, got ${scanned}`);
    assert.deepEqual(offenders, [], `these ship Italian to every locale: ${offenders.join(" | ")}`);
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

describe("one name per card", () => {
  /** Not a name any player reads on a card: the black joker is black, not black-and-white. */
  const ABBREVIATIONS = ["B/W", "B/N", "B/Z"];
  /** Every key that names a joker in the UI; each must agree with the cardView name. */
  const JOKER_ALIASES = {
    "cardView.jokerColored": ["rules.strengthJokerColored"],
    "cardView.jokerBlack": ["rules.strengthJokerBlack"],
  } as const;

  test("no locale abbreviates a joker's colour", () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const name of LOCALE_NAMES) {
      for (const [key, value] of Object.entries(LOCALES[name] as Record<string, string>)) {
        scanned += 1;
        for (const abbreviation of ABBREVIATIONS) {
          if (value.includes(abbreviation)) violations.push(`${name}:${key} — ${abbreviation}`);
        }
      }
    }
    assert.ok(scanned > 1500, `expected to scan every locale string, got ${scanned}`);
    assert.deepEqual(violations, [], `these strings abbreviate a joker: ${violations.join(" | ")}`);
  });

  test("a joker is called the same thing on the card, in the lobby and in the rules", () => {
    const violations: string[] = [];
    for (const name of LOCALE_NAMES) {
      const catalogue = LOCALES[name] as Record<string, string>;
      for (const [canonical, aliases] of Object.entries(JOKER_ALIASES)) {
        for (const alias of aliases) {
          const expected = catalogue[canonical];
          assert.ok(expected, `${name} has no key "${canonical}"`);
          if (catalogue[alias].toLowerCase() !== expected.toLowerCase()) {
            violations.push(`${name}:${alias} is "${catalogue[alias]}", not "${expected}"`);
          }
        }
      }
    }
    assert.deepEqual(violations, [], `these disagree: ${violations.join(" | ")}`);
  });
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

describe("every sentence that names the opening card interpolates it", () => {
  // The spoken form names the whole card, the banners its rank and suit — so the
  // placeholder differs, and only the ♠ half of the rule is common to all three.
  const KEYS = [
    ["gameTable.playA11ySpokenStartCard", "{{card}}"],
    ["gameTable.startCardBannerSelf", "{{suit}}"],
    ["gameTable.startCardBannerOther", "{{suit}}"],
  ] as const;

  test("no locale hardcodes ♠ — the 2-player fallback opener can hold any suit", () => {
    for (const [key, placeholder] of KEYS) {
      for (const name of LOCALE_NAMES) {
        assert.ok(
          !LOCALES[name][key].includes("♠"),
          `${name}["${key}"] hardcodes ♠ instead of interpolating ${placeholder}`
        );
        assert.ok(
          LOCALES[name][key].includes(placeholder),
          `${name}["${key}"] is missing the ${placeholder} placeholder entirely`
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
    assert.equal(translate("it", "common.close"), "Chiudi");
    assert.equal(translate("en", "common.close"), "Close");
    assert.equal(translate("sq", "common.close"), "Mbyll");
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
      // An intent's acknowledgement is machine-read: the client branches on
      // whether a code is present, and never renders one. Only a code that
      // travels with a `message:` reaches a player's eyes, so only those need
      // a catalogue entry — a code carried by both shapes still matches on the
      // emitted one.
      const rendered = source.replace(/ok: false, code: "[A-Z_]+"/g, "");
      for (const m of rendered.matchAll(/code: "([A-Z_]+)"/g)) emitted.add(m[1]);
      // seatClaimCode() and its siblings return the code directly.
      for (const m of rendered.matchAll(/return "([A-Z][A-Z_]{3,})";/g)) emitted.add(m[1]);
    }
    assert.ok(
      emitted.has("EXCHANGE_PENDING"),
      "the ack exclusion took a code that is also emitted to the player"
    );
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
    // Read across the socket family rather than one file: which module the
    // rejoin handler sits in is a layout decision, and the contract being
    // checked here is not.
    const source = ["socket.ts", "socketRooms.ts", "socketGameplay.ts"]
      .map((f) => readFileSync(path.join(SERVER_DIR, f), "utf8"))
      .join("\n");
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

describe("no key outlives its last reader", () => {
  // The test above is this one for a single prefix. Every other key had
  // nothing: a screen could be deleted and the sentences it used stayed
  // behind, translated in three languages for nobody, which is how #507's
  // seven survived #502.

  /**
   * Where a `t()` call can live. `tests/` is deliberately out: a key a test
   * names in an assertion has no reader in the app, and counting one would
   * let a suite keep a dead sentence alive.
   */
  const READER_DIRS = ["app", "components", "context", "lib", "scripts", "server", "shared"];

  /**
   * A key nothing spells out because it is assembled at runtime, against the
   * single place that assembles it. `where` and `needle` are read from disk
   * on every run, so an entry cannot outlive its constructor — one cannot be
   * added to silence a real orphan without naming code that builds the key.
   *
   * What it still cannot see: `rules.faq` is bounded by a count private to
   * `app/rules.tsx`, so lowering that count leaves the keys above it exempt,
   * and `server.*` is a prefix — its per-code check is the separate test
   * above. The other five entries name the id or the range, which is what
   * closes them.
   */
  const CONSTRUCTED: {
    covers: (key: string, named: Set<string>) => boolean;
    where: string;
    needle: string;
  }[] = [
    {
      covers: (key) => key.startsWith("server."),
      where: "lib/i18n.ts",
      needle: "`server.${payload.code}`",
    },
    {
      // Both halves ride the base `tn()` is called with, so a pair whose
      // caller is gone is reported as both halves.
      covers: (key, named) =>
        /_(one|other)$/.test(key) && named.has(key.replace(/_(one|other)$/, "")),
      where: "lib/i18n.ts",
      needle: "`${base}${suffix}`",
    },
    {
      covers: (key) => /^rules\.faq\.q\d+$/.test(key),
      where: "app/rules.tsx",
      needle: "`rules.faq.q${n}`",
    },
    {
      // The question and the answer are built a line apart and one can go
      // without the other, so an entry covering both would keep half the
      // catalogue exempt on the strength of the other half's constructor.
      covers: (key) => /^rules\.faq\.a\d+$/.test(key),
      where: "app/rules.tsx",
      needle: "`rules.faq.a${n}`",
    },
    {
      covers: (key) => /^month\.(?:[1-9]|1[0-2])$/.test(key),
      where: "lib/rating.ts",
      needle: "`month.${month}`",
    },
    // The three id-derived sets take the ids themselves rather than the
    // prefix. A prefix exempts whatever is written under it, so dropping a
    // card back would leave its name translated in three languages with
    // nothing able to reach it — the shape this whole block exists to catch.
    {
      covers: (key) => CARD_BACK_IDS.some((id) => key === `cosmetics.back.${id}`),
      where: "lib/cosmetics.ts",
      needle: "`cosmetics.back.${id}`",
    },
    {
      covers: (key) => TABLE_FELT_IDS.some((id) => key === `cosmetics.felt.${id}`),
      where: "lib/cosmetics.ts",
      needle: "`cosmetics.felt.${id}`",
    },
    {
      covers: (key) => BOT_PERSONALITIES.some((p) => key === `bot.${p.id}Blurb`),
      where: "lib/botPersonalities.ts",
      needle: "`bot.${id}Blurb`",
    },
  ];

  function readerSources(): { file: string; source: string }[] {
    return READER_DIRS.flatMap((dir) => {
      const root = path.join(REPO_ROOT, dir);
      return readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => ({ file: `${dir}/${f}`, source: readFileSync(path.join(root, f), "utf8") }));
    });
  }

  /**
   * Every quoted key-shaped token in `source`, in all three quote styles.
   *
   * Deliberately not a string tokenizer: an apostrophe in a comment opens a
   * literal that runs to the next one, and every name after it in the file
   * is lost — a scan that fails that way reports live keys as dead, which is
   * indistinguishable from the defect. A key has no whitespace, so matching
   * one directly cannot desynchronise.
   */
  function namesIn(source: string, into: Set<string>): void {
    for (const m of source.matchAll(/(["'`])([\w.]+)\1/g)) into.add(m[2]);
  }

  function orphansAmong(keys: string[], named: Set<string>): string[] {
    return keys.filter(
      (key) => !named.has(key) && !CONSTRUCTED.some(({ covers }) => covers(key, named))
    );
  }

  // Read on first use rather than here: every other scan in this file walks
  // the tree inside a test body, so a directory that cannot be read fails one
  // test instead of the whole file's collection.
  let cached: Set<string> | undefined;
  function namedKeys(): Set<string> {
    if (!cached) {
      cached = new Set<string>();
      for (const { source } of readerSources()) namesIn(source, cached);
    }
    return cached;
  }

  test("every constructed-key entry still points at the code that builds it", () => {
    for (const { where, needle } of CONSTRUCTED) {
      const source = readFileSync(path.join(REPO_ROOT, where), "utf8");
      assert.ok(source.includes(needle), `${where} no longer builds ${needle}`);
    }
  });

  test("no constructed-key entry covers nothing", () => {
    // A shape that matches no key is a claim going spare, and the next key
    // written under it inherits an exemption nobody chose to give it.
    for (const { where, needle, covers } of CONSTRUCTED) {
      const covered = Object.keys(en).filter((key) => covers(key, namedKeys()));
      assert.ok(covered.length > 0, `${where}'s ${needle} covers no key in en`);
    }
  });

  test("the scan can tell a named key from an orphan", () => {
    assert.deepEqual(orphansAmong(["lobby.title", "lobby.gone"], new Set(["lobby.title"])), [
      "lobby.gone",
    ]);
    assert.deepEqual(orphansAmong(["server.ANY", "month.3", "bot.luanBlurb"], new Set()), []);
    assert.deepEqual(orphansAmong(["x_one", "x_other"], new Set(["x"])), []);
    assert.deepEqual(orphansAmong(["x_one", "x_other"], new Set()), ["x_one", "x_other"]);
  });

  test("every key in en is named by something outside locales/", () => {
    const orphans = orphansAmong(Object.keys(en), namedKeys());
    assert.deepEqual(orphans, [], `nothing reads these keys: ${orphans.join(", ")}`);
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

  /** Same-file functions by name — `function f() {}` and `const f = () => {}` alike. */
  function localFunctions(sourceFile: ts.SourceFile): Map<string, ts.Node> {
    const functions = new Map<string, ts.Node>();
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        functions.set(node.name.text, node.body);
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        functions.set(node.name.text, node.initializer.body);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return functions;
  }

  /** What a body hands back: a concise arrow's expression, or every `return`. */
  function returnedExpressions(body: ts.Node): ts.Node[] {
    const returned: ts.Node[] = [];
    if (!ts.isBlock(body)) return [body];
    const visit = (node: ts.Node) => {
      // A nested function's returns are its own, not this one's.
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)
      ) {
        return;
      }
      if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
      ts.forEachChild(node, visit);
    };
    visit(body);
    return returned;
  }

  /**
   * Every `ObjectLiteralExpression` reachable from `node` without crossing
   * into a nested call's own arguments — so `a ? {x} : {y}`, `a ?? {x}`,
   * `{x} as T` and any other wrapper report the object literals inside them,
   * while `helper({x})` reports none: that argument belongs to `helper`.
   *
   * What a same-file helper *returns* is the opposite case — that is this
   * response's payload, wherever it was assembled. `res.json(sessionUser(user))`
   * was invisible here until the callee was followed, which took register,
   * login and /api/auth/me out of the scan without failing anything.
   */
  function objectLiteralsIn(
    node: ts.Node,
    functions: Map<string, ts.Node>,
    following: Set<string> = new Set()
  ): ts.ObjectLiteralExpression[] {
    const found: ts.ObjectLiteralExpression[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        found.push(n);
        return;
      }
      if (ts.isCallExpression(n)) {
        const callee = ts.isIdentifier(n.expression) ? n.expression.text : null;
        const body = callee === null ? undefined : functions.get(callee);
        // `following` is what stops a helper that calls itself recursing forever.
        if (callee !== null && body !== undefined && !following.has(callee)) {
          following.add(callee);
          for (const returned of returnedExpressions(body)) {
            found.push(...objectLiteralsIn(returned, functions, following));
          }
          following.delete(callee);
        }
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  /** Every object literal reachable from a delivering call's arguments, at any position and depth. */
  function payloadObjects(sourceFile: ts.SourceFile): { text: string; names: Set<string> }[] {
    const objects: { text: string; names: Set<string> }[] = [];
    const functions = localFunctions(sourceFile);
    for (const call of responseCalls(sourceFile)) {
      for (const arg of call.arguments) {
        for (const obj of objectLiteralsIn(arg, functions)) {
          objects.push({
            text: obj.getText(sourceFile),
            names: propertyNames(obj),
          });
        }
      }
    }
    return objects;
  }

  /** The scan run against a source written to exercise one shape of it. */
  function scan(source: string): { text: string; names: Set<string> }[] {
    return payloadObjects(
      ts.createSourceFile("synthetic.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    );
  }

  test("a payload a same-file helper returns is still the response's payload", () => {
    const objects = scan(`
      function sessionUser(user) {
        return { id: user.id, username: user.username, message: "welcome back" };
      }
      app.post("/api/login", (req, res) => res.json(sessionUser(user)));
    `);

    assert.equal(objects.length, 1, "the helper's payload was never reached");
    assert.ok(objects[0].names.has("message"));
    assert.ok(!objects[0].names.has("code"), "this is the payload the scan must be able to fail");
  });

  test("the same helper with a code is reached too, and has nothing to report", () => {
    const objects = scan(`
      function sessionUser(user) {
        return { id: user.id, code: "OK", message: "welcome back" };
      }
      app.post("/api/login", (req, res) => res.json(sessionUser(user)));
    `);

    assert.equal(objects.length, 1);
    assert.ok(objects[0].names.has("code"));
  });

  test("what a helper is passed still belongs to the helper", () => {
    const objects = scan(`
      function render(options) { return { code: "OK" }; }
      app.get("/x", (req, res) => res.json(render({ message: "an argument, not a payload" })));
    `);

    assert.deepEqual(
      objects.map((o) => [...o.names].sort()),
      [["code"]],
      "an argument handed to a helper was mistaken for the response"
    );
  });

  test("a helper that calls itself does not hang the scan", () => {
    const objects = scan(`
      function build(n) { return n > 0 ? build(n - 1) : { message: "done" }; }
      app.get("/x", (req, res) => res.json(build(3)));
    `);

    assert.equal(objects.length, 1);
    assert.ok(objects[0].names.has("message"));
  });

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
      objectCount > 112,
      `expected to find the server's response payload objects, got ${objectCount} (115 when this floor was set)`
    );
    assert.deepEqual(
      violations,
      [],
      `these player-facing responses carry no code: ${violations.join(" | ")}`
    );
  });
});

describe("Albanian card terminology", () => {
  /**
   * Attested in docs/albanian-card-terminology-research.md. `Trefla` and `Pika`
   * were a calque of *trefoil* and a borrowing of German *Pik*, attested as card
   * suits nowhere; docs/RULES.md's cited Albanian text opens the game with
   * "ai lojtar që ka 3 maç". `Kupë`, not `Kupa`, is the bare singular the
   * `{{rank}} {{suit}}` slot wants — `Kupa` is the noun's plural, per #29.
   */
  const SUITS = {
    "cards.suitHearts": "Kupë",
    "cards.suitDiamonds": "Karo",
    "cards.suitClubs": "Spathi",
    "cards.suitSpades": "Maç",
  } as const;

  /** `vlerë` and `ngjyrë` are feminine; `bojë` is paint, not a card's suit. */
  const AGREEMENT_ERRORS = ["të të njëjtit vlerë", "të njëjtit bojë", "të njëjtin bojë", "bojë"];

  test("each suit carries its attested name", () => {
    for (const [key, expected] of Object.entries(SUITS)) {
      assert.equal((sq as Record<string, string>)[key], expected, `sq.ts ${key}`);
    }
  });

  test("no Albanian string mis-genders vlerë or calls a suit paint", () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const [key, value] of Object.entries(sq as Record<string, string>)) {
      scanned += 1;
      for (const error of AGREEMENT_ERRORS) {
        if (value.includes(error)) violations.push(`${key} — "${error}"`);
      }
    }
    assert.ok(scanned > 500, `expected to scan all of sq.ts, got ${scanned}`);
    assert.deepEqual(violations, [], `these disagree in gender: ${violations.join(" | ")}`);
  });

  /** Attested over "Zonja" in #29. */
  const QUEEN = {
    "cards.rankQueen": "Çupa",
    "rules.strengthQueen": "Çupa",
  } as const;

  test("the Queen is named Çupa, not Zonja", () => {
    for (const [key, expected] of Object.entries(QUEEN)) {
      assert.equal((sq as Record<string, string>)[key], expected, `sq.ts ${key}`);
    }
  });

  /** Attested combination names, settled in #29. */
  const COMBO_NAMES = {
    "gameShared.comboPair": "Dyshe",
    "gameShared.comboTriple": "Treshe",
    "rules.comboPairName": "Dyshe",
    "rules.comboTripleName": "Treshe",
    "tutorial.typePair": "një Dyshe",
    "tutorial.typeTriple": "një Treshe",
    "tutorial.typeBomb": "një Katërshe",
  } as const;

  test("combination names use the attested register, not a literal Bombë calque", () => {
    for (const [key, expected] of Object.entries(COMBO_NAMES)) {
      assert.equal((sq as Record<string, string>)[key], expected, `sq.ts ${key}`);
    }
    assert.match((sq as Record<string, string>)["gameShared.comboBomb"], /Katërshe/, "sq.ts gameShared.comboBomb");
    assert.match((sq as Record<string, string>)["rules.comboBombName"], /Katërshe/, "sq.ts rules.comboBombName");
  });

  /**
   * "mund" is a modal clitic here, not the bare verb "beats" — the literal
   * calque ("Shkalla Mbretërore mund gjithçka") is ungrammatical Albanian.
   * Fixed to "i mund të gjitha" / "nuk mund t'i përgjigjesh" per #29.
   */
  test("the royal-straight-is-unbeatable strings use the fixed mund clitic", () => {
    assert.match(
      sq["gameTable.playA11ySpokenRoyalUnbeatable"],
      /\bi mund të gjitha\b/,
      "gameTable.playA11ySpokenRoyalUnbeatable",
    );
    assert.match(
      sq["gameTable.playA11ySpokenRoyalUnbeatable"],
      /nuk mund t'i përgjigjesh\b/,
      "gameTable.playA11ySpokenRoyalUnbeatable",
    );
    assert.match(sq["tutorial.errRoyalBeatsAll"], /\bi mund të gjitha\b/, "tutorial.errRoyalBeatsAll");
    assert.match(
      sq["tutorial.errRoyalBeatsAll"],
      /nuk mund t'i përgjigjesh\b/,
      "tutorial.errRoyalBeatsAll",
    );
  });
});
