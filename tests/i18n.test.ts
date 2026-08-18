// Localization layer tests (lib/i18n.ts, locales/{it,en,sq}.ts).
//
// This is what stops a future string being added to one locale only: the
// type system already forces locales/en.ts and locales/sq.ts to declare the
// exact key set of locales/it.ts (see the `Record<keyof typeof it, string>`
// annotation on each), but that only catches a *missing* key, not a stray
// runtime mismatch, an empty translation, or an interpolation placeholder
// that no longer matches across locales — hence these tests.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// @ts-ignore — see tests/helpers.ts for why the .ts extension is required
import { it } from "../locales/it.ts";
// @ts-ignore
import { en } from "../locales/en.ts";
// @ts-ignore
import { sq } from "../locales/sq.ts";
// @ts-ignore
import { translate, interpolate } from "../lib/i18n.ts";

const LOCALES = { it, en, sq } as const;
type LocaleName = keyof typeof LOCALES;
const LOCALE_NAMES = Object.keys(LOCALES) as LocaleName[];

describe("locale key parity", () => {
  const itKeys = Object.keys(it).sort();

  for (const name of LOCALE_NAMES) {
    test(`${name} has exactly the same key set as it (the source of truth)`, () => {
      const keys = Object.keys(LOCALES[name]).sort();
      assert.deepEqual(
        keys,
        itKeys,
        `${name} key set diverges from locales/it.ts`
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

  test("every locale uses the same {{placeholder}} names as it for a given key", () => {
    for (const key of Object.keys(it) as (keyof typeof it)[]) {
      const expected = placeholders(it[key]);
      if (expected.length === 0) continue;
      for (const name of LOCALE_NAMES) {
        const actual = placeholders(LOCALES[name][key]);
        assert.deepEqual(
          actual,
          expected,
          `${name}["${key}"] placeholders ${JSON.stringify(actual)} != it's ${JSON.stringify(expected)}`
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
      (code) => !Object.prototype.hasOwnProperty.call(it, `server.${code}`)
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
        translate(locale, `server.${code}` as keyof typeof it)
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
    const sources = ["server/routes.ts", "server/socket.ts"]
      .map((rel) => readFileSync(path.join(repoRoot, rel), "utf8"))
      .join("\n");
    const unused = Object.keys(it)
      .filter((key) => key.startsWith("server."))
      .map((key) => key.slice("server.".length))
      .filter((code) => !sources.includes(`"${code}"`));
    assert.deepEqual(unused, [], `unused server.* keys: ${unused.join(", ")}`);
  });
});
