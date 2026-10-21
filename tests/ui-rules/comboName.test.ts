import { test } from "node:test";
import assert from "node:assert/strict";
import { comboName, spokenComboName } from "../../lib/comboName.ts";
import { en } from "../../locales/en.ts";
import { it } from "../../locales/it.ts";
import { sq } from "../../locales/sq.ts";
import { translate } from "../../lib/i18n.ts";
import { COMBINATION_TYPES } from "../../lib/game/gameEngine.ts";

const GLYPHED = ["bomb", "royal_straight"];

for (const [name, catalogue] of [["en", en], ["it", it], ["sq", sq]] as const) {
  test(`${name} names every combination type distinctly, glyph only on bomb and royal straight`, () => {
    const t = ((key: string) => translate(name, key as never)) as Parameters<typeof comboName>[1];
    const names = COMBINATION_TYPES.map((type) => comboName(type, t));
    assert.ok(names.every((n) => n.length > 0 && !n.startsWith("term.")), `${name} has a missing name`);
    assert.equal(new Set(names).size, names.length);
    assert.ok(Object.keys(catalogue).length > 0);
    COMBINATION_TYPES.forEach((type, i) => {
      const glyphed = /^[^\p{L}\p{N}]/u.test(names[i]);
      assert.equal(glyphed, GLYPHED.includes(type), `${name} ${type} glyph`);
      const spoken = spokenComboName(type, t);
      assert.match(spoken, /^[\p{L}\p{N}]/u);
      assert.ok(names[i].endsWith(spoken));
    });
  });
}
