import { test } from "node:test";
import assert from "node:assert/strict";
import { voterCount } from "../../server/game/gameRoom.ts";
import { everySeatedVoted } from "../../server/game/tableVotes.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

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
        const rematchAndEndMatch = votes.size >= voterCount(game);
        const newMatch = Object.values(game.playerMap).every((uid) => votes.has(uid));
        assert.equal(everySeatedVoted(votes, game), rematchAndEndMatch, `${roster.join(",")} / ${voters.join(",")}`);
        assert.equal(everySeatedVoted(votes, game), newMatch, `${roster.join(",")} / ${voters.join(",")}`);
        cases++;
      }
    }
  }
  assert.ok(cases > 100, `only ${cases} tallies checked`);
});
