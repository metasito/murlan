// tests/botFill.test.ts — pure seat-assignment logic, extracted so it is testable
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  botSeatsFromPersonality,
  buildSeatRoster,
  isContestedTable,
  seatAssignmentsFromRoster,
} from "../server/onlineGameLogic.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("empty seats are filled with bots up to maxPlayers", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    4,
    { fillWithBots: true, botPersonality: "gent" }
  );
  assert.equal(roster.length, 4);
  assert.equal(roster.filter((r) => r.isBot).length, 3);
  assert.deepEqual(roster.map((r) => r.seatIndex), [0, 1, 2, 3]);
  for (const bot of roster.filter((r) => r.isBot)) assert.equal(bot.personality, "gent");
});

// Three seats on one personality would otherwise be three players called "Gent".
test("bot seats sharing a personality get distinguishable names", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    4,
    { fillWithBots: true, botPersonality: "gent" }
  );
  const names = roster.filter((r) => r.isBot).map((r) => r.username);
  assert.deepEqual(names, ["Gent 1", "Gent 2", "Gent 3"]);
  assert.equal(new Set(names).size, names.length);
});

test("a single bot seat keeps the bare personality name", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    2,
    { fillWithBots: true, botPersonality: "drita" }
  );
  assert.deepEqual(roster.filter((r) => r.isBot).map((r) => r.username), ["Drita"]);
});

test("without fillWithBots the roster is only the humans", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    4,
    { fillWithBots: false }
  );
  assert.equal(roster.length, 1);
});

test("bot seats are excluded from match scoring", () => {
  const roster = buildSeatRoster([{ seatIndex: 0, userId: "u1", username: "Ana" }], 2, { fillWithBots: true });
  const scored = roster.filter((r) => !r.isBot).map((r) => r.userId);
  assert.deepEqual(scored, ["u1"]);
});

// A bot-filled table stays playable — practice against the AI is a feature —
// but its results must not be recorded, or a private room of bots is an
// endless supply of guaranteed points, streaks and achievements.
test("a lone human plus bots is not a recordable table", () => {
  const roster = buildSeatRoster([{ seatIndex: 0, userId: "u1", username: "Ana" }], 4, {
    fillWithBots: true,
  });
  const humans = roster.filter((r) => !r.isBot).length;
  const bots = roster.length - humans;
  assert.equal(isContestedTable(humans, bots), false);
});

test("bot-majority tables of every size are excluded", () => {
  assert.equal(isContestedTable(1, 3), false); // 4-seat room, one human
  assert.equal(isContestedTable(1, 2), false); // 3-seat room, one human
});

test("tables humans hold at least half of are recorded", () => {
  assert.equal(isContestedTable(2, 2), true); // two friends plus two bots
  assert.equal(isContestedTable(1, 1), true); // a straight duel with the AI
  assert.equal(isContestedTable(4, 0), true); // a full human table
  assert.equal(isContestedTable(3, 1), true); // one seat vacated mid-game
});

// seatAssignmentsFromRoster is what startMatchAction actually calls to build
// playerMap and botSeatsAtStart — driven here through the same buildSeatRoster
// output rather than a hand-rolled roster, so a mutation that stops
// populating either map, or populates it for every seat regardless of the
// roster, shows up here rather than only in a caller that passes it by hand.
test("seatAssignmentsFromRoster splits a mixed roster exactly, bots on one side and humans on the other", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u_ana", username: "Ana" }],
    4,
    { fillWithBots: true, botPersonality: "gent" }
  );
  const { playerMap, botSeatsAtStart } = seatAssignmentsFromRoster(roster);
  assert.deepEqual(playerMap, { 0: "u_ana" });
  assert.deepEqual([...botSeatsAtStart].sort(), [1, 2, 3]);
});

test("seatAssignmentsFromRoster keys both maps by roster position, not the DB's own seatIndex", () => {
  // A gap in the DB seat numbering: two humans at seats 0 and 3, no bots.
  const roster = buildSeatRoster(
    [
      { seatIndex: 0, userId: "u_ana", username: "Ana" },
      { seatIndex: 3, userId: "u_ben", username: "Ben" },
    ],
    4,
    { fillWithBots: false }
  );
  const { playerMap, botSeatsAtStart } = seatAssignmentsFromRoster(roster);
  // initializeGame seats this roster at positions 0 and 1, not 0 and 3.
  assert.deepEqual(playerMap, { 0: "u_ana", 1: "u_ben" });
  assert.deepEqual(botSeatsAtStart, new Set());
});

test("botSeatsFromPersonality reads a born bot, not a seat a human vacated", () => {
  const players = [
    { personality: undefined }, // human seat 0
    { personality: "gent" as const }, // born-bot seat 1
    // A seat that started human and was later vacated: type flips to "ai",
    // personality is never set (vacateSeat doesn't touch it).
    { personality: undefined },
  ];
  assert.deepEqual(botSeatsFromPersonality(players), new Set([1]));
});

// seatAssignmentsFromRoster landed with one caller (startMatchAction) and an
// unused-import lint warning is not the same guarantee: `void
// seatAssignmentsFromRoster;` silences the warning without calling it, so a
// second, inline rebuild of the same maps leaves tsc, lint and every other
// test green. Counting call sites — `name(`, not merely `name` — is the fact
// that tells the two apart.
test("one function builds a match's playerMap and botSeatsAtStart", () => {
  const TARGET = "seatAssignmentsFromRoster";
  const HOME = "server/onlineGameLogic.ts";
  const callers = ["app", "components", "context", "lib", "server"]
    .flatMap((dir) => walk(path.join(repoRoot, dir)))
    .filter((rel) =>
      new RegExp(String.raw`\b${TARGET}\s*\(`).test(readFileSync(path.join(repoRoot, rel), "utf8"))
    );

  assert.deepEqual(
    callers.sort(),
    [HOME, "server/tableHandlers.ts"].sort(),
    `${TARGET} is how a match's roster becomes playerMap and botSeatsAtStart, ` +
      `so a caller that stops calling it, or a second inline copy, shows up ` +
      `here: ${callers.join(", ")}`
  );
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return out;
}
