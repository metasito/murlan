import { test } from "node:test";
import assert from "node:assert/strict";
import { gameErrorText } from "../../components/table/spokenLabels.ts";
import { playRefusalLabel } from "../../lib/table/playRefusal.ts";
import { translate, translateServerPayload, type ServerPayload, type TFn } from "../../lib/i18n.ts";
import type { Locale } from "../../shared/i18n.ts";
import type { Card, SelectionRefusal } from "../../lib/game/gameEngine.ts";

const SELECTION_REFUSALS = Object.keys({
  notACombination: true,
  needsStartCard: true,
  royalUnbeatable: true,
  bombOnly: true,
  wrongType: true,
  wrongLength: true,
  tooLow: true,
} satisfies Record<SelectionRefusal, true>) as SelectionRefusal[];

const fourOfHearts: Card = { id: "4_hearts", rank: "4", suit: "hearts", isJoker: false };
const tIn = (locale: Locale): TFn => (key, params) => translate(locale, key, params);
const refused = (refusal: string): ServerPayload => ({
  code: "INVALID_MOVE",
  message: "Invalid move",
  params: { refusal },
});

for (const locale of ["en", "it", "sq"] as const) {
  for (const refusal of SELECTION_REFUSALS) {
    test(`${locale}: a refused ${refusal} reads GIOCA's sentence`, () => {
      const t = tIn(locale);
      const giocaSays = playRefusalLabel({ refusal, isMyTurn: true, isFinished: false, openingCard: fourOfHearts }, t);
      assert.equal(gameErrorText(refused(refusal), fourOfHearts, t), giocaSays);
      assert.notEqual(giocaSays, translate(locale, "server.INVALID_MOVE"));
    });
  }
}

test("en: the float names the card actually refused, not a rank with a fixed suit", () => {
  const t = tIn("en");
  assert.equal(gameErrorText(refused("tooLow"), fourOfHearts, t), "card too low");
  assert.equal(gameErrorText(refused("needsStartCard"), fourOfHearts, t), "the first play must include the 4 of Hearts");
});

test("an unknown refusal and a code that is no refused selection read as translateServerPayload has it", () => {
  const t = tIn("en");
  for (const p of [
    refused("fromANewerServer"),
    refused("play"),
    { code: "INVALID_MOVE", message: "Invalid move", params: {} },
    { code: "CANNOT_PASS", message: "x", params: { refusal: "tooLow" } },
    { code: "INVALID_CARD", message: "x" },
  ]) {
    assert.equal(gameErrorText(p, fourOfHearts, t), translateServerPayload(p), JSON.stringify(p));
  }
});
