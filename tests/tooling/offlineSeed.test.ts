import { test } from "node:test";
import assert from "node:assert/strict";
import { offlineSave } from "../e2e/helpers/offlineSeed.ts";

const personalities = (save: ReturnType<typeof offlineSave>) => save.gameState.players.map((p) => p.personality);

test("the lobby's own bots keep the lobby's personalities", () => {
  assert.deepEqual(personalities(offlineSave({ seats: 4 })), [undefined, "luan", "besnik", "gent"]);
});

test("named seats carry no personality unless one is asked for", () => {
  assert.deepEqual(personalities(offlineSave({ seats: 3, names: ["Ana", "Luan", "Gent"] })), [undefined, undefined, undefined]);
  assert.deepEqual(
    personalities(offlineSave({ seats: 2, names: ["Ana", "Besnik"], personalities: [undefined, "luan"] })),
    [undefined, "luan"]
  );
});
