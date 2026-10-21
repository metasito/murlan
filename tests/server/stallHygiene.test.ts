// Outbound calls and writes that must not hold a request, a deal or the pool hostage.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { sendMail } from "../../server/http/mail.ts";
import { OUTBOUND_TIMEOUT_MS } from "../../server/http/outbound.ts";
import { notifyUser } from "../../server/socket/push.ts";
import { dealRound } from "../../server/game/dealRound.ts";
import { ERROR_GROUP_WINDOW_DAYS, installServerErrorRecorder, serverErrorsDropped } from "../../server/http/serverErrors.ts";
import { logger, setErrorRecorder } from "../../server/shared/logger.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { db, pool, openDatabase } from "../../server/store/db.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";
import { emptyRankTally } from "../../lib/game/gameEngine.ts";

openDatabase();

/** A fetch that never answers on its own, and an `AbortSignal.timeout` the test fires. */
function neverAnswering(t: TestContext) {
  const timeouts: number[] = [];
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    timeouts.push(ms);
    return controller.signal;
  });
  t.mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
    })
  );
  return { timeouts, expire: () => controller.abort() };
}

function quietDb(t: TestContext) {
  t.mock.method(db(), "insert", () => ({ values: async () => {} }));
}

test("a mail provider that never answers resolves false", async (t) => {
  quietDb(t);
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM_ADDRESS };
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM_ADDRESS = "noreply@example.test";
  t.after(() => {
    for (const [k, v] of [["RESEND_API_KEY", saved.key], ["MAIL_FROM_ADDRESS", saved.from]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const fetchHangs = neverAnswering(t);
  const sent = sendMail("a@example.test", "s", "t", "user-1");
  fetchHangs.expire();
  assert.equal(await sent, false);
  assert.deepEqual(fetchHangs.timeouts, [OUTBOUND_TIMEOUT_MS]);
});

test("a push service that never answers lets notifyUser return", async (t) => {
  t.mock.method(db(), "select", () => ({
    from: () => ({ where: async () => [{ token: "ExponentPushToken[a]", locale: "en" }] }),
  }));
  const fetchHangs = neverAnswering(t);
  const done = notifyUser("user-1", { title: "Murlan", code: "FRIEND_INVITE", params: { username: "Ana" } });
  await new Promise((r) => setImmediate(r));
  fetchHangs.expire();
  await done;
  assert.deepEqual(fetchHangs.timeouts, [OUTBOUND_TIMEOUT_MS]);
});

test("a hanging status write still deals the round", async (t) => {
  const { rt, sent } = recordingRuntime({ writers: { updateRoomStatus: () => new Promise(() => {}) } });
  const game = onlineTable({ roomId: "deal-hangs", maxPlayers: 2 });
  const players = ["player_0", "player_1"].map((id) => ({ id, name: id, hand: [], type: "human" as const }));
  const state: GameState = {
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: emptyRankTally(),
    lastMove: { seq: 0, kind: "deal" },
  };
  t.after(() => clearRoomTimers("deal-hangs"));

  const settled = await Promise.race([
    dealRound(rt, game, state).then(() => "dealt"),
    new Promise((r) => setTimeout(() => r("stalled"), 200)),
  ]);
  assert.equal(settled, "dealt");
  const emitted = sent.map((e) => e.event);
  assert.ok(emitted.includes("game:started"), `emitted: ${emitted.join(", ")}`);
});

test("the server-error recorder does not queue behind a starved pool", async (t) => {
  const inserts = t.mock.method(db(), "insert", () => ({ values: async () => {} }));
  const stderr = t.mock.method(process.stderr, "write", () => true);
  let waiting = 3;
  t.mock.getter(pool(), "waitingCount", () => waiting);
  installServerErrorRecorder();
  t.after(() => setErrorRecorder(undefined));

  const before = serverErrorsDropped();
  logger.error("starved");
  logger.error("starved again");
  assert.equal(inserts.mock.callCount(), 0);
  assert.equal(serverErrorsDropped(), before + 2, "a skipped line is still counted");
  assert.ok(stderr.mock.calls.some((c) => String(c.arguments[0]).includes("starved")));
  assert.ok(
    stderr.mock.calls.some((c) => String(c.arguments[0]).includes(`${before + 2} dropped`)),
    "the stderr line carries the running count"
  );

  waiting = 0;
  logger.error("served");
  assert.equal(inserts.mock.callCount(), 1);
  assert.equal(serverErrorsDropped(), before + 2);
});

test("drops older than the error-group window fall out of the count", (t) => {
  t.mock.method(process.stderr, "write", () => true);
  t.mock.getter(pool(), "waitingCount", () => 1);
  const start = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: start });
  installServerErrorRecorder();
  t.after(() => setErrorRecorder(undefined));

  const before = serverErrorsDropped();
  logger.error("old outage");
  assert.equal(serverErrorsDropped(), before + 1);
  t.mock.timers.setTime(start + (ERROR_GROUP_WINDOW_DAYS + 1) * 86_400_000);
  assert.equal(serverErrorsDropped(), 0);
});

test("a room's status writes land in the order they were issued", async (t) => {
  const started: string[] = [];
  const landed: string[] = [];
  const release = new Map<string, () => void>();
  t.mock.method(db(), "update", () => ({
    set: ({ status }: { status: string }) => ({
      where: () => {
        started.push(status);
        return new Promise<void>((resolve) =>
          release.set(status, () => {
            landed.push(status);
            resolve();
          })
        );
      },
    }),
  }));

  const dealt = roomStore.updateRoomStatus("ordered-room", "in_progress");
  const closed = roomStore.updateRoomStatus("ordered-room", "finished");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, ["in_progress"], "the later write ran beside the earlier one");

  release.get("in_progress")!();
  await dealt;
  await new Promise((r) => setImmediate(r));
  release.get("finished")!();
  await closed;
  assert.deepEqual(landed, ["in_progress", "finished"]);
});
