// `game:state` that goes unacknowledged is sent once more, re-derived from the
// table as it is by then, never replayed from the snapshot that missed.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime, stubTransport } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { sendGameStateTo } from "../../server/game/gamePersistence.ts";
import { socketOutbox } from "../../server/socket/socketOutbox.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { startRound } from "../../lib/game/gameEngine.ts";
import type { WireGameState } from "../../shared/protocol.ts";

const ROOM = "state-retry-room";
const SEATS = ["Ana", "B1"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

afterEach(() => activeGames.delete(ROOM));

test("the retry sends the live table, not the state that missed", () => {
  const { rt, missAck, events } = recordingRuntime();
  const sent = onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: startRound(SEATS, "free_for_all") });
  const live = { ...sent, gameState: { ...sent.gameState, passCount: 1 } };
  activeGames.set(ROOM, live);

  missAck("ana");
  sendGameStateTo(rt, "ana", sent);

  const states = events("game:state") as WireGameState[];
  assert.deepEqual(
    states.map((s) => s.passCount),
    [0, 1]
  );
});

test("a table that ended before the retry sends nothing more", () => {
  const { rt, missAck, events } = recordingRuntime();
  const game = onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: startRound(SEATS, "free_for_all") });

  missAck("ana");
  sendGameStateTo(rt, "ana", game);

  assert.equal(events("game:state").length, 1);
});

test("the socket outbox retries an unacknowledged state exactly once", () => {
  const delivered: unknown[] = [];
  const renders: boolean[] = [];
  const io = stubTransport({
    to: () => ({
      timeout: () => ({
        emit: (_event: string, state: unknown, ack: (err: unknown) => void) => {
          delivered.push(state);
          ack(new Error("operation has timed out"));
        },
      }),
    }),
  });

  socketOutbox(io).state("ana", (retrying) => {
    renders.push(retrying);
    return { retrying } as unknown as WireGameState;
  });

  assert.deepEqual(renders, [false, true]);
  assert.equal(delivered.length, 2);
});
