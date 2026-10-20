// tests/tooling/soakRejoinOracle.test.ts — what an unanswered rejoin is evidence of.
//
// `tests/tooling/soakAwayWindow.test.ts` keeps the away window a safe multiple under the shortest
// grace, so the oracle's reading stays true. That check compares two constants before the
// run starts and cannot see the run: a stalled runner, a paused container, a GC pause or a
// grace lowered by a config the soak never reads all break the premise while it still passes.
//
// `SEAT_RELEASED` makes the same claim checkable at runtime — but it is not "a grace
// expired". Four routes reach it through `vacateSeat`, and two of them (a deliberate
// `room:leave`, a deleted account) involve no grace at all. What makes the reading sound is
// that the harness never gives a seat up itself, and that fact is carried by the seat rather
// than assumed: `leave()` is the only way to emit `room:leave`, and it records that it did.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";
import { AWAY_WINDOW_MS, REJOIN_BUDGET_MS, heldSeatGraceMs, rejoinFailure } from "../soak/soak.ts";

const TESTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(TESTS_DIR, "..");

/**
 * Every file that holds a `Seat`, found rather than listed: a seat's socket is reached only
 * through `seatSocket()`, whose type has no `room:leave`, but the client a seat is built from
 * is a raw socket in the same file, and a new file added to a list nobody updates is the
 * failure this whole ticket is about.
 */
function filesHoldingASeat(): string[] {
  const self = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join("/");
  return sourcesUnder(REPO_ROOT, ["tests"])
    .filter(([rel, text]) =>
      /^tests\/soak\/[^/]+\.ts$/.test(rel) || (rel !== self && /from "\.{1,2}\/(soak\/)?soak\.ts"/.test(text))
    )
    .map(([rel]) => path.join(REPO_ROOT, rel));
}

type Exempt = (line: string, source: string[], i: number) => boolean;

/** 1-based lines of `text`'s code matching `pattern`, minus any the exemption forgives. */
function offendingLines(text: string, pattern: RegExp, exempt: Exempt = () => false): number[] {
  const source = blankComments(text).split("\n");
  return [...source.entries()].filter(([i, line]) => pattern.test(line) && !exempt(line, source, i)).map(([i]) => i + 1);
}

/** Lines matching `pattern` in those files, minus any the exemption forgives. */
function scan(pattern: RegExp, exempt?: Exempt): string[] {
  return filesHoldingASeat().flatMap((file) =>
    offendingLines(readFileSync(file, "utf8"), pattern, exempt).map((line) => `${path.relative(TESTS_DIR, file)}:${line}`)
  );
}

function seat(over: Partial<Parameters<typeof rejoinFailure>[0]> = {}) {
  return {
    username: "p1",
    lastRefusal: null,
    lastRefusalCode: null,
    gaveUpItsOwnSeat: false,
    ...over,
  };
}

const AWAY_MS = 4_211;

describe("reading the refusal a rejoin came back with", () => {
  test("a released seat the harness never gave up is the window outrunning the grace", () => {
    const v = rejoinFailure(
      seat({ lastRefusalCode: "SEAT_RELEASED", lastRefusal: "game:rejoin_failed SEAT_RELEASED: x" }),
      AWAY_MS
    );

    assert.equal(v.kind, "away-window-outran-grace");
    // Both numbers, because the diagnosis is the comparison between them and neither
    // side of it is safe to assume: away the longer, the release was right and
    // something stalled; away the shorter, the server let the seat go early. Told
    // only that a seat was released, the reader cannot tell those apart.
    assert.match(v.detail, new RegExp(`${AWAY_MS}ms`));
    assert.match(v.detail, new RegExp(`${heldSeatGraceMs()}ms`));
  });

  test("the away time is the one measured, never the window that was asked for", () => {
    // The run this fires on is by definition the one where the plan and the clock
    // disagree, so printing the plan prints the number already known to be wrong.
    const v = rejoinFailure(seat({ lastRefusalCode: "SEAT_RELEASED" }), AWAY_MS);

    assert.doesNotMatch(v.detail, new RegExp(String(AWAY_WINDOW_MS.floor + AWAY_WINDOW_MS.spread)));
  });

  test("names the seat, so a failure points at one of four clients", () => {
    const v = rejoinFailure(seat({ username: "soak3", lastRefusalCode: "SEAT_RELEASED" }), AWAY_MS);

    assert.match(v.detail, /soak3/);
  });

  test("UNAUTHORIZED keeps #736's signature rather than becoming a harness artefact", () => {
    // The defect this suite exists for reads UNAUTHORIZED. Reported as the window
    // breaking, a real auth hole would be filed against the soak's own constants.
    const v = rejoinFailure(
      seat({ lastRefusalCode: "UNAUTHORIZED", lastRefusal: "game:rejoin_failed UNAUTHORIZED: no" }),
      AWAY_MS
    );

    assert.equal(v.kind, "rejoin-unanswered");
    assert.match(v.detail, /UNAUTHORIZED/);
  });

  for (const code of ["GAME_NOT_FOUND", "GAME_NO_LONGER_VALID", "SERVER_ERROR"]) {
    test(`${code} is left alone`, () => {
      assert.equal(rejoinFailure(seat({ lastRefusalCode: code }), AWAY_MS).kind, "rejoin-unanswered");
    });
  }

  test("silence is still silence, and says so", () => {
    const v = rejoinFailure(seat(), AWAY_MS);

    assert.equal(v.kind, "rejoin-unanswered");
    assert.match(v.detail, /said nothing at all/);
  });

  test("a seat the harness released itself is not the window breaking", () => {
    // The one-directional part. If a leave is ever added to the chaos, its own
    // SEAT_RELEASED is correct behaviour and must not be reported as a grace expiring.
    const v = rejoinFailure(seat({ lastRefusalCode: "SEAT_RELEASED", gaveUpItsOwnSeat: true }), AWAY_MS);

    assert.equal(v.kind, "rejoin-unanswered");
  });

  test("the budget it waited is the runner's own, in the sentence either way", () => {
    // Taken from the module rather than repeated here: a copy of the number is a
    // second definition of it, and DEADLINE_SCALE moves the real one on CI.
    for (const s of [seat({ lastRefusalCode: "SEAT_RELEASED" }), seat()]) {
      assert.match(rejoinFailure(s, AWAY_MS).detail, new RegExp(`${REJOIN_BUDGET_MS}ms`));
    }
  });
});

describe("the premise the reading rests on", () => {
  const recordsTheLeave: Exempt = (line, source, i) => /gaveUpItsOwnSeat/.test(source.slice(Math.max(0, i - 3), i + 2).join("\n"));

  test("the scan reads the seat's own leave, and a comment beside a bare one does not forgive it", () => {
    const harness = filesHoldingASeat().find((f) => f.endsWith(path.join("soak", "soak.ts")));
    assert.ok(harness, "the walk never reached the soak harness");
    assert.ok(offendingLines(readFileSync(harness, "utf8"), /room:leave/).length > 0, "the scan does not see the leave Seat.leave() emits");
    assert.deepEqual(offendingLines('// gaveUpItsOwnSeat\nsocket.emit("room:leave", { roomId });', /room:leave/, recordsTheLeave), [2]);
    assert.deepEqual(offendingLines('this.#gaveUpItsOwnSeat = true;\nthis.#socket.emit("room:leave", { roomId });', /room:leave/, recordsTheLeave), []);
    assert.deepEqual(offendingLines("// the old room:leave path\nconst x = 1;", /room:leave/, recordsTheLeave), []);
  });

  test("no file holding a Seat leaves a room except through the call that records it", () => {
    // The load-bearing fact, checked rather than written down: a `room:leave` the seat
    // does not know about turns every later SEAT_RELEASED into a false diagnosis, and
    // the run would still be green. Unquoted, so a hoisted `const LEAVE = "room:leave"`
    // is caught too, on the raw client socket `seatSocket()`'s type cannot see.
    const offenders = scan(/room:leave/, recordsTheLeave);

    assert.deepEqual(
      offenders,
      [],
      "a room:leave that does not set gaveUpItsOwnSeat makes the SEAT_RELEASED reading wrong " +
        "and nothing else would notice. Emit it through Seat.leave()."
    );
  });
});
