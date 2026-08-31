// tests/resultActionLabels.test.ts — the result screen's two primary labels fit
// beside a Home button of a stated width (#588), and `tests/e2e/resultActions
// .spec.ts` proves that in a browser at one locale only, because reaching the
// screen costs a played hand.
//
// This is what makes that one locale the right one: it fails the moment a
// translation grows past the one the browser measures, which is the only way
// the browser check can quietly stop covering the worst case.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { en } from "../locales/en.ts";
import { it as itLocale } from "../locales/it.ts";
import { sq } from "../locales/sq.ts";

const LOCALES = { en, it: itLocale, sq } as const;
const KEYS = ["result.nextHand", "result.newMatch", "result.home"] as const;

/** The locale `tests/e2e/resultActions.spec.ts` runs at. */
const MEASURED = "it";

describe("the result screen's action labels", () => {
  for (const key of KEYS) {
    test(`${key} is at its longest in the locale the browser measures`, () => {
      const lengths = Object.entries(LOCALES).map(
        ([locale, catalogue]) =>
          [locale, (catalogue as Record<string, string>)[key].length] as const
      );
      const longest = Math.max(...lengths.map(([, n]) => n));
      const measured = lengths.find(([locale]) => locale === MEASURED)![1];

      assert.equal(
        measured,
        longest,
        `${key}: ${MEASURED} is ${measured} characters but ${lengths
          .filter(([, n]) => n === longest)
          .map(([locale]) => locale)
          .join("/")} is ${longest} — the browser is no longer measuring the worst case, so either re-point MEASURED or check both there`
      );
    });
  }

  // The two removals the owner asked for, kept removed: a key that comes back
  // is a tile or a legend that came back with it.
  test("neither the player count nor the points legend has a string any more", () => {
    for (const [locale, catalogue] of Object.entries(LOCALES)) {
      for (const key of ["result.statPlayers", "result.legend"]) {
        assert.equal(
          key in (catalogue as Record<string, string>),
          false,
          `${locale} still carries ${key}`
        );
      }
    }
  });
});
