import { test } from "node:test";
import assert from "node:assert/strict";
import { byId, propsEqualExcept, shallowEqual } from "../../lib/memo.ts";

type Props = { card: { id: string }; place: { x: number }; entry: unknown; zIndex: number; extra?: number };
const equal = propsEqualExcept<Props>({ card: byId, place: shallowEqual, entry: "ignore" });
const base: Props = { card: { id: "3_spades" }, place: { x: 1 }, entry: { kind: "deal" }, zIndex: 0 };

test("a prop nobody names is compared by identity", () => {
  assert.equal(equal(base, { ...base }), true);
  assert.equal(equal(base, { ...base, zIndex: 1 }), false);
});

test("a named prop is compared by its own test", () => {
  assert.equal(equal(base, { ...base, card: { id: "3_spades" }, place: { x: 1 } }), true);
  assert.equal(equal(base, { ...base, card: { id: "4_hearts" } }), false);
  assert.equal(equal(base, { ...base, place: { x: 2 } }), false);
});

test("an ignored prop is never compared", () => {
  assert.equal(equal(base, { ...base, entry: null }), true);
});

test("a prop on only one side is a difference", () => {
  assert.equal(equal(base, { ...base, extra: 1 }), false);
  assert.equal(equal({ ...base, extra: 1 }, base), false);
});

test("shallowEqual compares one level down, by identity", () => {
  const inner = { x: 1 };
  assert.equal(shallowEqual({ a: inner, b: 2 }, { a: inner, b: 2 }), true);
  assert.equal(shallowEqual({ a: inner }, { a: { x: 1 } }), false);
  assert.equal(shallowEqual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(shallowEqual({ a: 1, c: undefined }, { a: 1, b: undefined }), false);
});
