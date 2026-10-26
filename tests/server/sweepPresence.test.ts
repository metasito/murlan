// The finished-table sweep disposes a table only on the cluster's word that
// nobody at it is connected; a cluster that did not answer said nothing.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { sweepFinishedTables } from "../../server/game/gamePersistence.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const ROOM = "sweep-presence-room";
const SEATS = ["Ana", "Besi"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

function finishedTable() {
  activeGames.set(
    ROOM,
    onlineTable({
      roomId: ROOM,
      playerMap: { 0: "ana", 1: "besi" },
      gameState: { ...startRound(SEATS, "free_for_all"), roundOver: true },
    })
  );
}

afterEach(() => activeGames.delete(ROOM));

test("a sweep whose presence query fails disposes nothing", async () => {
  const { rt, cluster, sent } = recordingRuntime();
  cluster.down = true;
  finishedTable();

  await sweepFinishedTables(rt);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(activeGames.has(ROOM), true, "a table was disposed because the cluster did not answer");
  assert.deepEqual(sent, [], "the table was told something on a cluster that said nothing");
});

test("a sweep disposes a finished table nobody is connected to, and keeps one somebody is", async () => {
  const { rt, cluster } = recordingRuntime();
  cluster.online = new Set(["besi"]);
  finishedTable();
  await sweepFinishedTables(rt);
  assert.equal(activeGames.has(ROOM), true, "a table was disposed under a connected player");

  cluster.online = new Set();
  await sweepFinishedTables(rt);
  assert.equal(activeGames.has(ROOM), false);
});

test("a sweep with no finished table asks nobody, and disposes only the finished one among several", async () => {
  let asked = 0;
  const { rt, cluster } = recordingRuntime({
    presence: {
      connectedUserIds: async () => {
        asked++;
        return new Set(cluster.online);
      },
    },
  });
  const OTHER = "sweep-presence-other-room";
  activeGames.set(
    OTHER,
    onlineTable({ roomId: OTHER, playerMap: { 0: "cami" }, gameState: startRound(SEATS, "free_for_all") })
  );

  await sweepFinishedTables(rt);
  assert.equal(asked, 0, "the cluster was asked about a sweep with nothing to dispose");
  assert.equal(activeGames.has(OTHER), true);

  finishedTable();
  await sweepFinishedTables(rt);
  assert.equal(asked, 1);
  assert.equal(activeGames.has(ROOM), false);
  assert.equal(activeGames.has(OTHER), true, "a table still in play was swept because nobody was connected");
  activeGames.delete(OTHER);
});
