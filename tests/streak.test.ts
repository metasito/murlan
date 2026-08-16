// tests/streak.test.ts — consecutive-days-played, the returning-player half of
// the stats screen (the existing "streak" is consecutive *wins*, which is a
// different thing entirely).
//
// The subtle case is the one that decides whether the feature is any good: a
// streak must survive the whole of the day it has not been extended on yet.
// Breaking it at midnight means every player wakes up to a broken streak.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dailyStreak, utcDay } from "../lib/streak.ts";

const TODAY = "2026-08-16";

describe("dailyStreak", () => {
  test("no games played is a streak of zero", () => {
    assert.equal(dailyStreak([], TODAY), 0);
  });

  test("playing today alone is a streak of one", () => {
    assert.equal(dailyStreak(["2026-08-16T09:00:00Z"], TODAY), 1);
  });

  test("counts consecutive days back from today", () => {
    const played = [
      "2026-08-16T09:00:00Z",
      "2026-08-15T22:00:00Z",
      "2026-08-14T10:00:00Z",
    ];
    assert.equal(dailyStreak(played, TODAY), 3);
  });

  test("several games on one day count once", () => {
    const played = [
      "2026-08-16T09:00:00Z",
      "2026-08-16T11:00:00Z",
      "2026-08-16T23:59:00Z",
      "2026-08-15T08:00:00Z",
    ];
    assert.equal(dailyStreak(played, TODAY), 2);
  });

  test("a streak survives the day it has not been extended on yet", () => {
    // Played yesterday, nothing yet today. Breaking here would show every
    // player a broken streak every morning until their first game.
    const played = ["2026-08-15T20:00:00Z", "2026-08-14T20:00:00Z"];
    assert.equal(dailyStreak(played, TODAY), 2);
  });

  test("missing a whole day breaks it", () => {
    // Last played the day before yesterday: yesterday was missed entirely.
    const played = ["2026-08-14T20:00:00Z", "2026-08-13T20:00:00Z"];
    assert.equal(dailyStreak(played, TODAY), 0);
  });

  test("only the run ending now counts, not the longest run ever", () => {
    const played = [
      "2026-08-16T09:00:00Z",
      // gap
      "2026-08-10T09:00:00Z",
      "2026-08-09T09:00:00Z",
      "2026-08-08T09:00:00Z",
    ];
    assert.equal(dailyStreak(played, TODAY), 1);
  });

  test("counts across a month boundary", () => {
    const played = ["2026-09-01T09:00:00Z", "2026-08-31T09:00:00Z", "2026-08-30T09:00:00Z"];
    assert.equal(dailyStreak(played, "2026-09-01"), 3);
  });

  test("counts across a year boundary", () => {
    const played = ["2027-01-01T09:00:00Z", "2026-12-31T09:00:00Z"];
    assert.equal(dailyStreak(played, "2027-01-01"), 2);
  });

  test("counts across a leap day", () => {
    const played = ["2028-03-01T09:00:00Z", "2028-02-29T09:00:00Z", "2028-02-28T09:00:00Z"];
    assert.equal(dailyStreak(played, "2028-03-01"), 3);
  });

  test("accepts Date objects as well as strings", () => {
    const played = [new Date("2026-08-16T09:00:00Z"), new Date("2026-08-15T09:00:00Z")];
    assert.equal(dailyStreak(played, TODAY), 2);
  });

  test("future timestamps do not extend the streak", () => {
    // Clock skew between the database and the process should not inflate it.
    const played = ["2026-08-20T09:00:00Z", "2026-08-16T09:00:00Z"];
    assert.equal(dailyStreak(played, TODAY), 1);
  });
});

describe("utcDay", () => {
  test("takes the UTC calendar day, not the local one", () => {
    assert.equal(utcDay("2026-08-16T23:30:00Z"), "2026-08-16");
    assert.equal(utcDay("2026-08-17T00:30:00Z"), "2026-08-17");
  });
});
