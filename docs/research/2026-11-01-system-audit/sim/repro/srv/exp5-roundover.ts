// Claim 5: the round-ending move's ack waits on database work (two writes + a rating preview); the
// round results are fire-and-forget, so a crash right after round_over loses them.
// One server (a killable child). Two human clients play round 1 (no exchange) following game:state.
// After a kill, a second instance boots on the same database and its sweep may finish what the
// first left pending. Also: /metrics scraped mid-round, and the cluster messages one move costs
// when the two seats sit on different instances (the ceiling that replaced NOTIFY's).
import {
  bootInstance, connect, killInstance, out, q, RedisTap, register, resetData, scrapeMetrics, sleep, tally,
  waitForPeers, type Client, type Instance,
} from "./lib.ts";
import { getAllValidPlays, getValidGivebackCards, tableDemand, type Move } from "../../../../../../lib/game/gameEngine.ts";
import type { WireGameState, WireRoomState } from "../../../../../../shared/protocol.ts";

const { log, save } = out("exp5.txt");

interface Seat {
  socket: Client;
  state: WireGameState | null;
}

function pickMove(s: WireGameState, seat: number): Move | null {
  const ex = s.exchangePhase;
  if (ex?.kind === "open") {
    if (ex.winnerIdx !== seat) return null;
    const hand = s.players[seat]?.hand ?? [];
    const [c] = getValidGivebackCards(hand as never, ex.cardFromLoser.id);
    return c ? { kind: "giveback", cardId: c.id } : null;
  }
  if (s.currentTurnIndex !== seat) return null;
  const hand = s.players[seat]?.hand ?? [];
  if (hand.length === 0) return null;
  const plays = getAllValidPlays(hand as never, tableDemand(s as never));
  if (plays.length === 0) return { kind: "pass" };
  return { kind: "play", cardIds: plays[0]!.cards.map((c) => c.id) };
}

function emitMove(socket: Client, move: Move, turn: string): Promise<{ ms: number; reply: unknown }> {
  const payload = move.kind === "play" ? { cardIds: move.cardIds, turn } : move.kind === "pass" ? { turn } : { cardId: move.cardId, turn };
  const event = move.kind === "play" ? "game:play" : move.kind === "pass" ? "game:pass" : "game:exchange_give_card";
  const t = performance.now();
  return new Promise((resolve) => {
    // Capped: the round-ending move's ack never comes if the server is killed mid-write.
    const timer = setTimeout(() => resolve({ ms: performance.now() - t, reply: null }), 6_000);
    socket.emit(event, payload, (reply: unknown) => {
      clearTimeout(timer);
      resolve({ ms: performance.now() - t, reply });
    });
  });
}

/** Plays one round to completion. `onRoundOver` fires the instant the first game:round_over lands. */
async function playRound(
  seats: Seat[],
  onRoundOver: () => void,
  midway: () => Promise<void> = async () => {}
): Promise<{ latencies: number[]; endMoveMs: number | null; moves: number }> {
  let over = false;
  let moves = 0;
  let midwayDone = false;
  const latencies: number[] = [];
  let endMoveMs: number | null = null;
  for (const s of seats) s.socket.on("game:round_over", () => { if (!over) { over = true; onRoundOver(); } });
  const deadline = Date.now() + 40_000;
  while (!over && Date.now() < deadline) {
    let acted = false;
    for (let i = 0; i < seats.length && !over; i++) {
      const s = seats[i];
      const st = s.state;
      if (!st || st.roundOver) continue;
      const move = pickMove(st, st.viewerSeatIndex ?? i);
      if (!move) continue;
      acted = true;
      const handBefore = (st.players[st.viewerSeatIndex ?? i]?.hand ?? []).length;
      const isEnder = move.kind === "play" && move.cardIds.length >= handBefore;
      const { ms } = await emitMove(s.socket, move, st.turn);
      moves += 1;
      if (moves === 6 && !midwayDone) {
        midwayDone = true;
        await midway();
      }
      // The move that empties this seat's hand is the round-ender; its ack is handleRoundOver's.
      if (isEnder) endMoveMs = ms;
      else latencies.push(ms);
      if (over) break;
      await sleep(10);
    }
    if (!acted) await sleep(20);
  }
  return { latencies, endMoveMs, moves };
}

async function openTable(
  inst: Instance,
  a: { cookie: string },
  b: { cookie: string },
  other: Instance = inst
): Promise<{ seats: Seat[]; room: WireRoomState }> {
  const s0 = await connect(inst.url, a.cookie, "web");
  const s1 = await connect(other.url, b.cookie, "web");
  const seats: Seat[] = [{ socket: s0, state: null }, { socket: s1, state: null }];
  seats.forEach((seat) => seat.socket.on("game:state", (st: WireGameState, ack?: () => void) => { seat.state = st; ack?.(); }));
  const room = await new Promise<WireRoomState>((resolve) => {
    s0.once("room:state", resolve);
    s0.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
  });
  await new Promise<void>((resolve) => {
    s1.once("room:state", () => resolve());
    s1.emit("room:join", { code: room.code });
  });
  s0.emit("room:start");
  const start = Date.now();
  while (!seats.every((s) => s.state) && Date.now() - start < 10_000) await sleep(50);
  return { seats, room };
}

function med(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function resultRows(roomId: string, userIds: string[]) {
  const n = async (tbl: string, col: string, ids: string[]) =>
    (await q<{ c: number }>(`SELECT count(*)::int c FROM ${tbl} WHERE ${col} = ANY($1)`, [ids]))[0].c;
  return {
    user_stats: await n("user_stats", "user_id", userIds),
    user_ratings: await n("user_ratings", "user_id", userIds),
    round_history: await n("round_history", "user_id", userIds),
    round_replays: (await q<{ c: number }>("SELECT count(*)::int c FROM round_replays WHERE room_id = $1", [roomId]))[0].c,
    pending_in_envelope: (await q<{ c: number }>(
      `SELECT coalesce(sum(jsonb_array_length(game_state->'pendingResults')), 0)::int c FROM active_games WHERE room_id = $1 AND jsonb_typeof(game_state->'pendingResults') = 'array'`,
      [roomId]
    ))[0].c,
  };
}

/** A replay of the room whose round left no round_history row: the orphan the audit's kill made. */
async function orphanReplays(roomId: string, userIds: string[]): Promise<number> {
  const [{ c }] = await q<{ c: number }>(
    `SELECT count(*)::int c FROM round_replays r WHERE r.room_id = $1
       AND NOT EXISTS (SELECT 1 FROM round_history h WHERE h.user_id = ANY($2))`,
    [roomId, userIds]
  );
  return c;
}

const D17 = [
  "event_loop_lag_p99_seconds", "pg_pool_total", "pg_pool_idle", "pg_pool_waiting", "redis_reconnects_total",
  "redis_stream_lag_seconds", "redis_stream_read_age_seconds", "state_acks_missed_total", "round_results_pending",
  "round_results_pending_age_seconds", "coalesced_writes_total", "limiter_fallbacks_total", "telemetry_rows_dropped_total",
  "pg_connection_headroom", "cluster_messages_total",
];
let metricsReport: string[] = [];

const tag = Date.now().toString(36);

async function clusterTrial(): Promise<string> {
  await resetData();
  const tap = new RedisTap();
  await tap.start();
  const A = await bootInstance("srvA", 5581);
  const B = await bootInstance("srvB", 5582);
  try {
    await waitForPeers(tap);
    const a = await register(A.url, `ca${tag}`);
    const b = await register(B.url, `cb${tag}`);
    const { seats } = await openTable(A, a, b, B);
    await sleep(500);
    const mark = tap.mark();
    const { moves, latencies } = await playRound(seats, () => {});
    await tap.settle();
    const heard = tap.since(mark);
    for (const s of seats) s.socket.close();
    const byType = Object.fromEntries(Object.entries(tally(heard)).map(([k, v]) => [k, v.n]));
    const counted = (await Promise.all([A, B].map((i) => scrapeMetrics(i.url))))
      .map((m) => (m.get("cluster_messages_total") ?? []).filter((l) => !l.startsWith("#")).map((l) => Number(l.split(" ").at(-1))).reduce((x, y) => x + y, 0));
    return `${moves} moves, ${heard.length} cluster messages heard = ${(heard.length / Math.max(1, moves)).toFixed(2)} per move (${JSON.stringify(byType)}); ` +
      `cluster_messages_total on A+B since boot ${counted[0]! + counted[1]!} (positive control for the soak's counter); ordinary move ack median ${med(latencies).toFixed(1)} ms`;
  } finally {
    await killInstance(A);
    await killInstance(B);
    await tap.stop();
  }
}

async function trial(label: string, killDelayMs: number | null): Promise<string> {
  await resetData();
  const inst = await bootInstance(`srvA`, 5581);
  try {
    const a = await register(inst.url, `a${tag}${label}`);
    const b = await register(inst.url, `b${tag}${label}`);
    const { seats, room } = await openTable(inst, a, b);
    let latencies: number[] = [];
    let endMoveMs: number | null = null;
    const onOver = () => {
      if (killDelayMs !== null) setTimeout(() => inst.child.kill("SIGKILL"), killDelayMs);
    };
    const midway = async () => {
      if (label !== "ctl0") return;
      const m = await scrapeMetrics(inst.url);
      metricsReport = D17.map((name) => {
        const samples = m.get(name);
        if (!samples) return `MISSING  ${name}`;
        return `exported ${name}  ${samples[0] ? `e.g. ${samples[0]}` : "(declared; no sample yet: a labelled counter shows one once it first counts)"}`;
      });
    };
    ({ latencies, endMoveMs } = await playRound(seats, onOver, midway));
    const alive = () => inst.child.exitCode === null && inst.child.signalCode === null;
    if (killDelayMs !== null && alive()) {
      await sleep(killDelayMs + 2_000);
      if (alive()) {
        inst.child.kill("SIGKILL");
        return `${label}: the round never ended within 40 s, so nothing was measured`;
      }
    }
    for (const s of seats) s.socket.close();
    if (killDelayMs === null) {
      await sleep(2_500); // positive control: let the fire-and-forget writes land
      const rows = await resultRows(room.roomId, [a.id, b.id]);
      return `${label}: ordinary move ack median ${med(latencies).toFixed(1)} ms (n=${latencies.length}), round-ending move ack ${endMoveMs?.toFixed(1)} ms; after 2.5 s: ${JSON.stringify(rows)}`;
    }
    await inst.exited;
    await sleep(500);
    const ids = [a.id, b.id];
    const rows = await resultRows(room.roomId, ids);
    const orphans = await orphanReplays(room.roomId, ids);
    const next = await bootInstance("srvA2", 5583, { env: { MURLAN_SWEEP_INTERVAL_MS: "1000" } });
    let after = await resultRows(room.roomId, ids);
    const deadline = Date.now() + 20_000;
    while (after.pending_in_envelope > 0 && Date.now() < deadline) {
      await sleep(250);
      after = await resultRows(room.roomId, ids);
    }
    await killInstance(next);
    return `${label} (kill +${killDelayMs} ms after round_over): round-ending ack ${endMoveMs?.toFixed(1) ?? "n/a"} ms; rows after kill: ${JSON.stringify(rows)}, orphaned replays ${orphans}; after a fresh instance's sweep: ${JSON.stringify(after)}, orphaned replays ${await orphanReplays(room.roomId, ids)}`;
  } finally {
    await killInstance(inst);
    await sleep(500);
  }
}

try {
  log("# exp5: round-ending move ack latency, and durability of results on a crash");
  log("\n## latency + positive control (no kill)");
  for (let i = 0; i < 2; i++) log("  " + (await trial(`ctl${i}`, null)));
  log("\n## /metrics mid-round (ctl0, after its sixth move): every D17 metric");
  for (const line of metricsReport) log("  " + line);
  log("\n## kill right after round_over (the audit lost stats/ratings/history and orphaned the replay)");
  for (const d of [0, 0, 0, 50, 200]) log("  " + (await trial(`kill`, d)));
  log("\n## cluster messages per move, the two seats on different instances (table on A, second seat on B)");
  log("  " + (await clusterTrial()));
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  save();
  process.exit(0);
}
