// Claim 5: the round-ending move's ack waits on database work (two writes + a rating preview); the
// round results are fire-and-forget, so a crash right after round_over loses them.
// One server (a killable child). Two human clients play round 1 (no exchange) following game:state.
import {
  bootInstance, connect, killInstance, out, q, register, resetData, sleep, type Client, type Instance,
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
async function playRound(seats: Seat[], onRoundOver: () => void): Promise<{ latencies: number[]; endMoveMs: number | null }> {
  let over = false;
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
      const move = pickMove(st, i);
      if (!move) continue;
      acted = true;
      const handBefore = (st.players[i]?.hand ?? []).length;
      const isEnder = move.kind === "play" && move.cardIds.length >= handBefore;
      const { ms } = await emitMove(s.socket, move, st.turn);
      // The move that empties this seat's hand is the round-ender; its ack is handleRoundOver's.
      if (isEnder) endMoveMs = ms;
      else latencies.push(ms);
      if (over) break;
      await sleep(10);
    }
    if (!acted) await sleep(20);
  }
  return { latencies, endMoveMs };
}

async function openTable(inst: Instance, a: { cookie: string }, b: { cookie: string }): Promise<{ seats: Seat[]; room: WireRoomState }> {
  const s0 = await connect(inst.url, a.cookie, "web");
  const s1 = await connect(inst.url, b.cookie, "web");
  const seats: Seat[] = [{ socket: s0, state: null }, { socket: s1, state: null }];
  seats.forEach((seat) => seat.socket.on("game:state", (st: WireGameState) => (seat.state = st)));
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
  };
}

const tag = Date.now().toString(36);

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
    ({ latencies, endMoveMs } = await playRound(seats, onOver));
    for (const s of seats) s.socket.close();
    if (killDelayMs === null) {
      await sleep(2_500); // positive control: let the fire-and-forget writes land
      const rows = await resultRows(room.roomId, [a.id, b.id]);
      return `${label}: ordinary move ack median ${med(latencies).toFixed(1)} ms (n=${latencies.length}), round-ending move ack ${endMoveMs?.toFixed(1)} ms; after 2.5 s: ${JSON.stringify(rows)}`;
    }
    await inst.exited;
    await sleep(500);
    const rows = await resultRows(room.roomId, [a.id, b.id]);
    return `${label} (kill +${killDelayMs} ms after round_over): round-ending ack ${endMoveMs?.toFixed(1) ?? "n/a"} ms; rows after kill: ${JSON.stringify(rows)}`;
  } finally {
    await killInstance(inst);
    await sleep(500);
  }
}

try {
  log("# exp5: round-ending move ack latency, and durability of results on a crash");
  log("\n## latency + positive control (no kill)");
  for (let i = 0; i < 2; i++) log("  " + (await trial(`ctl${i}`, null)));
  log("\n## kill right after round_over (expect stats/ratings/history/replay missing)");
  for (const d of [0, 0, 50, 200]) log("  " + (await trial(`kill`, d)));
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  save();
  process.exit(0);
}
