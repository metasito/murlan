// Ordering: the audit found the client applied any game:state without comparing its sequence, and
// showed the Postgres adapter's carrier (pg_notify over several connections) delivering seq 11
// before seq 10. D7 gave every state (roomId, epoch, seq) and the client a check
// (shared/stateOrder.ts, called from OnlineGameContext). This plays a round with the second seat on
// another instance, so each of its states crosses the cluster, and runs every state that seat
// received through the client's own check, in arrival order.
import {
  bootInstance, connect, killInstance, out, RedisTap, register, resetData, sleep, waitForPeers, type Client,
} from "./lib.ts";
import { orderOf, supersedes } from "../../../../../../shared/stateOrder.ts";
import { getAllValidPlays, getValidGivebackCards, tableDemand, type Move } from "../../../../../../lib/game/gameEngine.ts";
import type { StateOrder, WireGameState, WireRoomState } from "../../../../../../shared/protocol.ts";

const { log, save } = out("exp-ordering.txt");

function pickMove(s: WireGameState, seat: number): Move | null {
  const ex = s.exchangePhase;
  if (ex?.kind === "open") {
    if (ex.winnerIdx !== seat) return null;
    const [c] = getValidGivebackCards((s.players[seat]?.hand ?? []) as never, ex.cardFromLoser.id);
    return c ? { kind: "giveback", cardId: c.id } : null;
  }
  if (s.currentTurnIndex !== seat) return null;
  const hand = s.players[seat]?.hand ?? [];
  if (hand.length === 0) return null;
  const plays = getAllValidPlays(hand as never, tableDemand(s as never));
  return plays.length === 0 ? { kind: "pass" } : { kind: "play", cardIds: plays[0]!.cards.map((c) => c.id) };
}

function emitMove(socket: Client, move: Move, turn: string): Promise<void> {
  const payload = move.kind === "play" ? { cardIds: move.cardIds, turn } : move.kind === "pass" ? { turn } : { cardId: move.cardId, turn };
  const event = move.kind === "play" ? "game:play" : move.kind === "pass" ? "game:pass" : "game:exchange_give_card";
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 6_000);
    socket.emit(event, payload, () => { clearTimeout(timer); resolve(); });
  });
}

/** What the client does with states in arrival order: how many it takes, and how many it refuses. */
function applyInOrder(orders: (StateOrder | null)[]) {
  let last: StateOrder | null = null;
  let applied = 0;
  let refused = 0;
  for (const o of orders) {
    if (supersedes(o, last)) {
      applied += 1;
      last = o;
    } else refused += 1;
  }
  return { applied, refused };
}

const tap = new RedisTap();
const instances: Awaited<ReturnType<typeof bootInstance>>[] = [];
try {
  log("# ordering claim");
  log("\n## positive control: the client's own check (shared/stateOrder.ts) on an inverted pair");
  const ten: StateOrder = { roomId: "r", epoch: 1, seq: 10 };
  const eleven: StateOrder = { roomId: "r", epoch: 1, seq: 11 };
  const control = applyInOrder([eleven, ten]);
  log(`  arrival 11 then 10: applied ${control.applied}, refused ${control.refused} (the audit's client applied both, ending on 10)`);
  log(`  a newer epoch wins over a higher seq: ${supersedes({ roomId: "r", epoch: 2, seq: 1 }, { roomId: "r", epoch: 1, seq: 99 })}`);
  if (control.refused !== 1) throw new Error("positive control failed: the check took a stale state");

  await resetData();
  await tap.start();
  instances.push(await bootInstance("srvA", 5581), await bootInstance("srvB", 5582));
  const [A, B] = instances as [typeof instances[0], typeof instances[0]];
  await waitForPeers(tap);
  const tag = Date.now().toString(36);
  const a = await register(A.url, `oa${tag}`);
  const b = await register(B.url, `ob${tag}`);
  const s0 = await connect(A.url, a.cookie, "web");
  const s1 = await connect(B.url, b.cookie, "web");
  const seats: { socket: Client; state: WireGameState | null; arrivals: (StateOrder | null)[] }[] = [
    { socket: s0, state: null, arrivals: [] },
    { socket: s1, state: null, arrivals: [] },
  ];
  for (const seat of seats) seat.socket.on("game:state", (st: WireGameState, ack?: () => void) => { seat.arrivals.push(orderOf(st)); seat.state = st; ack?.(); });
  const room = await new Promise<WireRoomState>((resolve) => { s0.once("room:state", resolve); s0.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 }); });
  await new Promise<void>((resolve) => { s1.once("room:state", () => resolve()); s1.emit("room:join", { code: room.code }); });
  s0.emit("room:start");
  const mark = tap.mark();
  let over = false;
  for (const seat of seats) seat.socket.on("game:round_over", () => (over = true));
  const deadline = Date.now() + 60_000;
  while (!over && Date.now() < deadline) {
    let acted = false;
    for (let i = 0; i < 2 && !over; i++) {
      const st = seats[i]!.state;
      if (!st || st.roundOver) continue;
      const move = pickMove(st, st.viewerSeatIndex ?? i);
      if (!move) continue;
      acted = true;
      await emitMove(seats[i]!.socket, move, st.turn);
    }
    if (!acted) await sleep(20);
  }
  await sleep(1_000);
  const crossed = tap.since(mark).filter((h) => h.via === "inbox").length;
  log(`\n## live round, seat 0 on A (the owner), seat 1 on B: round over ${over}`);
  for (const [i, seat] of seats.entries()) {
    const orders = seat.arrivals;
    const missing = orders.filter((o) => o === null).length;
    let inversions = 0;
    for (let k = 1; k < orders.length; k++) if (orders[k] && orders[k - 1] && !supersedes(orders[k]!, orders[k - 1]!)) inversions += 1;
    const r = applyInOrder(orders);
    log(`  seat ${i} (${i === 0 ? "A, local" : "B, remote"}): ${orders.length} states, ${missing} without (roomId, epoch, seq), ${inversions} arrived out of order; the client's check applied ${r.applied}, refused ${r.refused}`);
  }
  log(`  inbox messages while the round played (states and intents crossing to and from B): ${crossed}`);
  log("  carrier: one inbox stream per instance, read in order by its one reader; sends to one instance wait for the one before (server/store/instanceInbox.ts inTurn)");
  s0.close();
  s1.close();
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  for (const i of instances) await killInstance(i);
  await tap.stop();
  save();
  process.exit(0);
}
