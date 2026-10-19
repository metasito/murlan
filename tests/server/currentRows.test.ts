import { test } from "node:test";
import assert from "node:assert/strict";
import { currentRows } from "../../server/game/ratings.ts";
import { START_RATING, seedRating } from "../../lib/game/rating.ts";

type Row = { userId: string; season: string; rating: number; rounds: number };

function readerOver(latest: Row[]) {
  let queries = 0;
  const reader = {
    selectDistinctOn: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => {
            queries += 1;
            return latest;
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof currentRows>[0];
  return { reader, queries: () => queries };
}

test("this season's row as is, a past season soft-reset, no row seeded fresh — in one query", async () => {
  const { reader, queries } = readerOver([
    { userId: "played", season: "2026-10", rating: START_RATING + 120, rounds: 14 },
    { userId: "lapsed", season: "2026-08", rating: START_RATING + 300, rounds: 40 },
  ]);
  const rows = await currentRows(reader, ["played", "lapsed", "new", "played"], "2026-10");

  assert.deepEqual(Object.fromEntries(rows), {
    played: { rating: START_RATING + 120, rounds: 14 },
    lapsed: { rating: seedRating(START_RATING + 300), rounds: 0 },
    new: { rating: seedRating(null), rounds: 0 },
  });
  assert.equal(queries(), 1);
});

test("nobody asked about is no query", async () => {
  const { reader, queries } = readerOver([]);
  assert.equal((await currentRows(reader, [], "2026-10")).size, 0);
  assert.equal(queries(), 0);
});
