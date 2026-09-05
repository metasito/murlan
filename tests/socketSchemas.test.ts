import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RoomStartSchema } from "../server/socketSchemas.ts";
import { getBotPersonality } from "../lib/botPersonalities.ts";

// A client on an older bundle can send a personality id this build no longer
// knows about — a personality removed after that bundle shipped (#904 removed
// "drita"/"ana"; the next removal will name two others). The payload must
// still resolve to the default, the way getBotPersonality already does,
// rather than having the whole room:start message rejected before it gets
// there. "shpresa" never existed as a personality id, so it stands for any
// such id without this test depending on which ones happen to be current.
const UNKNOWN_ID = "shpresa";

describe("room:start tolerates a bot personality this build no longer knows", () => {
  test("an unrecognized id parses rather than failing the whole payload", () => {
    const parsed = RoomStartSchema.safeParse({ fillWithBots: true, botPersonality: UNKNOWN_ID });
    assert.equal(parsed.success, true, "an unknown personality id must not reject room:start");
  });

  test("that parsed value still resolves to a real personality downstream", () => {
    const parsed = RoomStartSchema.safeParse({ fillWithBots: true, botPersonality: UNKNOWN_ID });
    assert.ok(parsed.success);
    const resolved = getBotPersonality(parsed.data.botPersonality);
    assert.notEqual(resolved.id, UNKNOWN_ID);
  });

  test("a known personality still parses and resolves to itself", () => {
    const parsed = RoomStartSchema.safeParse({ fillWithBots: true, botPersonality: "gent" });
    assert.ok(parsed.success);
    assert.equal(getBotPersonality(parsed.data.botPersonality).id, "gent");
  });

  test("an absent personality still parses as undefined", () => {
    const parsed = RoomStartSchema.safeParse({ fillWithBots: true });
    assert.ok(parsed.success);
    assert.equal(parsed.data.botPersonality, undefined);
  });

  test("an oversized string is still refused — this is a loosened enum, not an open field", () => {
    const parsed = RoomStartSchema.safeParse({ botPersonality: "x".repeat(65) });
    assert.equal(parsed.success, false);
  });
});
