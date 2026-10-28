// A file of its own: `beginShutdown` cannot be undone inside a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeOrphanedTables } from "../../server/game/tableLifecycle.ts";
import { beginShutdown } from "../../server/game/gameRoom.ts";
import { packPersistedState } from "../../shared/persistedEnvelope.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { aThreePlayed } from "../support/game.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";

test("a process on its way out wakes no table, however many have a player online", async (t) => {
  const state: GameState = {
    players: [
      { id: "player_0", name: "Ana", hand: [], type: "human" },
      { id: "player_1", name: "Besi", hand: [], type: "human" },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
  };
  const row = packPersistedState(
    state,
    {},
    0,
    "AAAAAA",
    {
      playerMap: { 0: "ana", 1: "besi" },
      scores: {},
      gameMode: "free_for_all",
      matchLength: "match",
      matchTarget: 21,
      maxPlayers: 2,
      roundsPlayed: 0,
      endedByVote: false,
      matchOver: false,
    },
    { vacatedSeats: [], releasedSeats: [], weakSeats: [], abandonedSeats: [] }
  );
  useMemoryTableStores(t, { rows: [["orphan-room", row]] });
  const { rt, cluster } = recordingRuntime();
  cluster.online.add("besi");
  const routed = t.mock.method(rt, "route", async () => ({ ok: true as const }));
  beginShutdown();
  await resumeOrphanedTables(rt);
  assert.equal(routed.mock.callCount(), 0);
});
