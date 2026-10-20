import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { seatedVoters, voteStateOf } from "../../server/game/gameRoom.ts";
import { emitEndMatchVoteState } from "../../server/game/tableBroadcasts.ts";
import { everySeatedVoted, rematchVoteAction } from "../../server/game/tableVotes.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";

type Seat = "human" | "bot" | "vacated";

function* rosters(size: number): Generator<Seat[]> {
  if (size === 0) return yield [];
  for (const rest of rosters(size - 1)) for (const seat of ["human", "bot", "vacated"] as const) yield [...rest, seat];
}

function* subsets<T>(items: T[]): Generator<T[]> {
  for (let mask = 0; mask < 1 << items.length; mask++) yield items.filter((_, i) => mask & (1 << i));
}

test("everySeatedVoted agrees with both counts it replaced, on every table and every tally", () => {
  let cases = 0;
  for (const playerCount of [2, 3, 4]) {
    for (const roster of rosters(playerCount)) {
      const playerMap: Record<number, string> = {};
      roster.forEach((seat, i) => {
        if (seat === "human") playerMap[i] = `u${i}`;
      });
      const vacatedSeats = new Map(
        roster.flatMap((seat, i) => (seat === "vacated" ? [[i, { userId: `gone${i}`, username: "" }] as const] : []))
      );
      const game = onlineTable({ roomId: "votes", playerMap, vacatedSeats });
      for (const voters of subsets(Object.values(playerMap))) {
        const votes = new Set(voters);
        const rematchAndEndMatch = votes.size >= Object.keys(game.playerMap).length;
        const newMatch = Object.values(game.playerMap).every((uid) => votes.has(uid));
        assert.equal(everySeatedVoted(votes, game), rematchAndEndMatch, `${roster.join(",")} / ${voters.join(",")}`);
        assert.equal(everySeatedVoted(votes, game), newMatch, `${roster.join(",")} / ${voters.join(",")}`);
        cases++;
      }
    }
  }
  assert.ok(cases > 100, `only ${cases} tallies checked`);
});

describe("a tally holding an id no seat holds", () => {
  const table = () =>
    onlineTable({
      roomId: "stray-vote",
      playerMap: { 0: "u0", 1: "u1" },
      gameState: { roundOver: true, players: [{ name: "U0" }, { name: "U1" }] } as never,
      rematchVotes: new Set(["stranger"]),
    });

  test("passes the old size count and fails everySeatedVoted", () => {
    const game = table();
    const votes = new Set(["u0", "stranger"]);
    assert.equal(votes.size >= Object.keys(game.playerMap).length, true);
    assert.equal(everySeatedVoted(votes, game), false);
  });

  test("does not close the rematch gate", async () => {
    const game = table();
    let roomReads = 0;
    const { rt } = recordingRuntime({
      store: {
        rooms: {
          getRoomById: async () => {
            roomReads++;
            return undefined;
          },
        } as never,
      },
    });
    const outcome = await rematchVoteAction(rt, game, { id: "v1", kind: "rematchVote", roomId: game.roomId, userId: "u0" });
    assert.deepEqual(outcome, { ok: true });
    assert.equal(roomReads, 0, "a gate the stray vote closed would read the room to deal");
    assert.deepEqual([...game.rematchVotes].sort(), ["stranger", "u0"]);
  });
});

test("every vote payload's total is the seated-voter set the gate counts", () => {
  const game = onlineTable({
    roomId: "totals",
    playerMap: { 0: "u0", 2: "u2" },
    vacatedSeats: new Map([[1, { userId: "gone", username: "" }]]),
  });
  assert.deepEqual([...seatedVoters(game)].sort(), ["u0", "u2"]);
  assert.equal(everySeatedVoted(new Set(seatedVoters(game)), game), true);
  assert.equal(voteStateOf(game).total, seatedVoters(game).length);
  const sent: unknown[] = [];
  emitEndMatchVoteState({ emit: (_event, ...args) => void sent.push(args[0]) }, game);
  assert.deepEqual(sent, [{ votes: [], total: seatedVoters(game).length }]);
});
