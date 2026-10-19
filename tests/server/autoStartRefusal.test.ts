// A matchmade table deals itself; when its owner refuses the deal, nobody pressed
// anything, so the refusal is logged rather than shown (owner decision D8).
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import { announceIfFilled } from "../../server/socket/socketTable.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { friendStore } from "../../server/store/friendStore.ts";
import { logger } from "../../server/http/logger.ts";
import { installClock } from "../../server/http/clock.ts";
import { autoStartDelayMs, clearAutoStart } from "../../server/game/gameTimers.ts";
import { refuse } from "../../server/shared/refusal.ts";
import { fakeClock } from "../helpers/fakeClock.ts";

const ROOM = { id: "autostart-room", code: "AUTOST", maxPlayers: 2, hostUserId: "h", autoStart: true };

afterEach(() => {
  clearAutoStart(ROOM.id);
  mock.restoreAll();
});

test("a refused auto-start is logged with its code and told to nobody", async () => {
  const clock = fakeClock();
  const restore = installClock(clock);
  try {
    mock.method(roomStore, "getRoomById", async () => ({ ...ROOM, status: "waiting" }));
    mock.method(roomStore, "getRoomPlayers", async () => [{ userId: "h" }, { userId: "g" }]);
    mock.method(friendStore, "getRoomInvitees", async () => []);
    const warned: Record<string, unknown>[] = [];
    mock.method(logger, "warn", (fields: Record<string, unknown>) => warned.push(fields));
    const sent: string[] = [];
    const io = {
      to: () => ({ emit: (event: string) => sent.push(event) }),
      serverSideEmit: (_e: string, _a: unknown, ack: (err: unknown, replies: unknown[]) => void) =>
        ack(null, [refuse("TEAMS_REQUIRE_FOUR")]),
    } as unknown as SocketServer;

    await announceIfFilled(io, ROOM, 2);
    clock.advance(autoStartDelayMs());
    for (let i = 0; i < 20 && warned.length === 0; i++) await new Promise((r) => setImmediate(r));

    assert.deepEqual(
      warned.map((w) => [w.roomId, w.code]),
      [[ROOM.id, "TEAMS_REQUIRE_FOUR"]]
    );
    assert.deepEqual(sent.filter((e) => e.endsWith(":error")), []);
  } finally {
    restore();
  }
});
