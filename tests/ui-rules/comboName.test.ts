import { test } from "node:test";
import assert from "node:assert/strict";
import { comboName } from "../../lib/comboName.ts";
import { en } from "../../locales/en.ts";
import { it } from "../../locales/it.ts";
import { sq } from "../../locales/sq.ts";
import { translate } from "../../lib/i18n.ts";
import type { CombinationType } from "../../lib/game/gameEngine.ts";

const KEY_OF = {
  single: "term.combo.single",
  pair: "term.combo.pair",
  triple: "term.combo.triple",
  straight: "term.combo.straight",
  bomb: "term.combo.bomb",
  royal_straight: "term.combo.royalStraight",
} as const satisfies Record<CombinationType, string>;

for (const [name, catalogue] of [["en", en], ["it", it], ["sq", sq]] as const) {
  test(`comboName returns the ${name} term.combo value for every type`, () => {
    const t = ((key: string) => translate(name, key as never)) as Parameters<typeof comboName>[1];
    for (const [type, key] of Object.entries(KEY_OF)) {
      const expected = (catalogue as Record<string, string>)[key];
      assert.ok(expected, `${name} ${key}`);
      assert.equal(comboName(type as CombinationType, t), expected);
    }
  });
}
