// The in-app FAQ's exchange answer says what the engine does with the giveback (docs/GAME-RULES.md § Decisions,
// "What the winner may hand back"): a card from 3 to 10, never the one just received, and nothing if there is none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "../../locales/en.ts";
import { it } from "../../locales/it.ts";
import { sq } from "../../locales/sq.ts";

const FAQ = [
  [en, "3 to 10", "never the card just received", "one-way"],
  [it, "da 3 a 10", "mai la carta appena ricevuta", "a senso unico"],
  [sq, "nga 3 deri në 10", "kurrë letrën që sapo mori", "me një drejtim"],
] as const;

test("every language's exchange answer carries the whole giveback rule, one-way case included", () => {
  for (const [locale, range, never, oneWay] of FAQ) {
    const answer = locale["rules.faq.a10"];
    for (const part of [range, never, oneWay]) assert.ok(answer.includes(part), `"${part}" is missing from: ${answer}`);
  }
});
