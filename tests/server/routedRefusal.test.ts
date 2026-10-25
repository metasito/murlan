// A refusal the owning table decides travels back as a value through the
// router, and the asking socket's `onEvent` is the one place it is told.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { GameSocket } from "../../server/socket/socketTypes.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { activeGames, socketRoomMap } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { registerGameplayHandlers } from "../../server/socket/socketGameplay.ts";
import { __resetRateLimits } from "../../server/socket/socketSafety.ts";
import { payload } from "../../server/shared/payload.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { emptyRankTally } from "../../lib/game/gameEngine.ts";

const ROOM = "routed-refusal-room";

function fakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emitted: { event: string; payload: unknown }[] = [];
  const socket = {
    id: "s1",
    data: { userId: "u1" },
    on: (event: string, cb: (...args: unknown[]) => void) => handlers.set(event, cb),
    emit: (event: string, body: unknown) => emitted.push({ event, payload: body }),
  };
  const send = (event: string, body?: unknown) =>
    new Promise<unknown>((resolve) => handlers.get(event)!(body, resolve));
  return { socket: socket as unknown as GameSocket, emitted, send };
}

before(() => {
  __resetRateLimits();
});

after(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  socketRoomMap.delete("s1");
});

test("a pass the owner refuses during the exchange reaches the asking socket once, from onEvent", async () => {
  const { rt, sent: ownerEmits } = recordingRuntime();
  activeGames.set(
    ROOM,
    onlineTable({
      roomId: ROOM,
      playerMap: { 0: "u1", 1: "u2" },
      gameState: {
        players: [
          { id: "p0", name: "A", hand: [], type: "human" },
          { id: "p1", name: "B", hand: [], type: "human" },
        ],
        currentTurnIndex: 0,
        lastPlayedCombination: null,
        lastPlayedBy: -1,
        passCount: 0,
        gameMode: "free_for_all",
        roundOver: false,
        finishingOrder: [],
        openingCard: null,
        playedRanks: emptyRankTally(),
        lastMove: { seq: 0, kind: "deal" },
        exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: { id: "A_spades", suit: "spades", rank: "A", isJoker: false } },
      },
    })
  );
  const { socket, emitted, send } = fakeSocket();
  socketRoomMap.set("s1", ROOM);
  registerGameplayHandlers({ rt, socket, userId: "u1" });

  assert.deepEqual(await send("game:pass", { seq: 0 }), { ok: false, code: "EXCHANGE_PENDING" });
  assert.deepEqual(emitted, [{ event: "game:error", payload: payload("EXCHANGE_PENDING") }]);
  assert.deepEqual(ownerEmits.filter((e) => e.event.endsWith(":error")), [], "the owner says nothing itself");
});
