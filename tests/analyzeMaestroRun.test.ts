// scripts/analyze-maestro-run.mjs correlates two independent logs on their own
// timestamps to prove #823's mechanism (a hierarchy fetch on an animating screen is
// starved by device jank) rather than assert it — these fixtures are small excerpts
// of the same shape as the two real runs the ticket measured.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appPidAt,
  parseCommandWindows,
  parseHierarchyFetches,
  parseJankFrames,
  summarize,
} from "../scripts/analyze-maestro-run.mjs";

const MAESTRO_LOG = [
  "16:53:21.726 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Assert that id: game-table is visible RUNNING",
  "16:54:34.704 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: Assert that id: game-table is visible COMPLETED",
  "16:54:34.708 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Assert that id: btn-passa is visible RUNNING",
].join("\n");

const LOGCAT = [
  "09-02 16:44:44.000 I/am_proc_start(  517): [0,1234,10192,com.murlan.cardgame,next-top-activity,{com.murlan.cardgame/com.murlan.cardgame.MainActivity}]",
  "09-02 16:53:30.000 D/Maestro ( 4647): View hierarchy received in 72800 ms",
  "09-02 16:53:31.000 I/OpenGLRenderer( 1234): Davey! duration=850ms; Flags=0",
  "09-02 16:53:32.000 I/OpenGLRenderer( 1234): Davey! duration=900ms; Flags=0",
  "09-02 16:53:33.000 I/OpenGLRenderer(9999): Davey! duration=999ms; Flags=0",
].join("\n");

test("matches a RUNNING command to its COMPLETED and reports the wait", () => {
  const windows = parseCommandWindows(MAESTRO_LOG);
  const gameTable = windows.find((w) => w.label === "Assert that id: game-table is visible");
  assert.equal(gameTable?.status, "COMPLETED");
  assert.equal(gameTable?.elapsedMs, 72978);
});

test("a command with no COMPLETED line closes against the endHint, not 0", () => {
  const windows = parseCommandWindows(MAESTRO_LOG, timeOfDayMsFixture("16:56:00.000"));
  const btnPassa = windows.find((w) => w.label === "Assert that id: btn-passa is visible");
  assert.equal(btnPassa?.status, "RUNNING");
  assert.ok(btnPassa!.elapsedMs > 60000, `expected a multi-minute lower bound, got ${btnPassa?.elapsedMs}`);
});

test("finds the app's pid from the launch closest before the window, not any launch", () => {
  const pid = appPidAt(LOGCAT, "com.murlan.cardgame", timeOfDayMsFixture("16:53:21.726"));
  assert.equal(pid, 1234);
});

test("jank is filtered to the app's own pid, not every process on the device", () => {
  const jank = parseJankFrames(LOGCAT, 1234);
  assert.equal(jank.length, 2, "the pid 9999 frame belongs to a different process and must not count");
});

test("a fetch that overlaps a window it starves shows up in that window's summary", () => {
  const windows = parseCommandWindows(MAESTRO_LOG, timeOfDayMsFixture("16:56:00.000"));
  const fetches = parseHierarchyFetches(LOGCAT);
  const jank = parseJankFrames(LOGCAT, 1234);
  const rows = summarize(windows, fetches, jank);
  const gameTable = rows.find((r) => r.label === "Assert that id: game-table is visible");
  assert.equal(gameTable?.fetchCount, 1);
  assert.equal(gameTable?.fetchTotalMs, 72800);
  assert.equal(gameTable?.jankCount, 2);
});

function timeOfDayMsFixture(hhmmss: string): number {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return ((h * 60 + m) * 60 + Math.trunc(s)) * 1000 + Math.round((s % 1) * 1000);
}
