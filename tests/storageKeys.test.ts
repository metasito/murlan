// tests/storageKeys.test.ts — every key is either the account's, which logout
// removes, or the device's, which it keeps. A key in neither list is one
// nobody decided about.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as keys from "../lib/storageKeys.ts";

test("every storage key is classified exactly once", () => {
  const { ACCOUNT_KEYS, DEVICE_KEYS, ...named } = keys;
  const classified: string[] = [...ACCOUNT_KEYS, ...DEVICE_KEYS];
  assert.deepEqual([...Object.values(named)].sort(), [...classified].sort());
  assert.equal(new Set(classified).size, classified.length);
});
