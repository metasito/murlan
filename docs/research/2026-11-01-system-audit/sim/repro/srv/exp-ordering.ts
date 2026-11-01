// Ordering: game:state carries turn and lastMove.seq, but the client applies any state without
// comparing either; across instances two states for one table can arrive out of order. The live
// game path is awkward to reorder (one client, one owning instance), so this is a labelled trace
// plus a transport-level demonstration that the adapter's carrier (pg_notify over several pool
// connections) does not preserve call order.
import pg from "pg";
import { DB_URL, out, sleep } from "./lib.ts";

const { log, save } = out("exp-ordering.txt");

try {
  log("# ordering claim");
  log("\n## Facts read from code (trace):");
  log("- game:state DOES carry a sequence: server/game/gamePersistence.ts sanitizeStateForPlayer sets");
  log("  turn = turnOf(state) = String(state.lastMove.seq) (lib/game/moves.ts). So 'no sequence field'");
  log("  in the report is WRONG; 'no sequence CHECK' is right.");
  log("- The client never compares it: context/OnlineGameContext.tsx onGameState (~448-478) parses the");
  log("  state and assigns gameStateRef.current = state unconditionally. The only 'seq' in that file is");
  log("  errorSeqRef, an unrelated error-dedup counter. No branch reads state.turn or lastMove.seq to");
  log("  reject or reorder an older state.");
  log("- Carrier: each game:state is io.to(userRoom).emit -> adapter.broadcast -> one pg_notify on one");
  log("  of the adapter pool's publisher connections (socketOutbox.ts, @socket.io/postgres-adapter).");
  log("  pg_notify delivers on COMMIT, and commit order across different connections is not call order,");
  log("  so a remote recipient can receive state N+1 before N. A LOCAL recipient is served in order");
  log("  (publishState calls emit per uid synchronously before the next move).");
  log("- The one self-correction (sendGameStateTo's retry) re-derives live state, so it never rewinds a");
  log("  client on its own; the reorder window is two genuinely distinct states racing across connections.");

  log("\n## Induced transport-level demonstration (labelled: not the full game path)");
  log("Two Postgres connections stand in for two of A's adapter publisher connections. Connection c1");
  log("sends the NOTIFY for move seq=N but commits slowly; c2 sends seq=N+1 and commits first. A LISTEN");
  log("client (as A's adapter subscriber on another instance) records arrival order.");
  const chan = "repro_order_demo";
  const listener = new pg.Client({ connectionString: `${DB_URL}?application_name=order_tap` });
  await listener.connect();
  const arrivals: { seq: number; at: number }[] = [];
  listener.on("notification", (n) => arrivals.push({ seq: JSON.parse(n.payload ?? "{}").seq, at: Date.now() }));
  await listener.query(`LISTEN ${chan}`);

  const c1 = new pg.Client({ connectionString: `${DB_URL}?application_name=pub1` });
  const c2 = new pg.Client({ connectionString: `${DB_URL}?application_name=pub2` });
  await c1.connect();
  await c2.connect();

  // c1 begins, queues the NOTIFY for the EARLIER move, but holds the transaction open (its connection
  // is the slow one). c2 sends the LATER move and commits immediately.
  await c1.query("BEGIN");
  await c1.query("SELECT pg_notify($1,$2)", [chan, JSON.stringify({ seq: 10, move: "earlier" })]);
  await c2.query("SELECT pg_notify($1,$2)", [chan, JSON.stringify({ seq: 11, move: "later" })]); // autocommit
  await sleep(300); // let seq 11 be delivered
  await c1.query("COMMIT"); // seq 10 delivered only now
  await sleep(300);

  log(`  LISTEN arrival order: ${arrivals.map((a) => a.seq).join(" then ")}`);
  const inverted = arrivals.length === 2 && arrivals[0].seq === 11 && arrivals[1].seq === 10;
  log(`  the later state (seq 11) arrived before the earlier (seq 10): ${inverted ? "YES" : "no"}`);
  log(`  With no client-side seq check (traced above), the client would apply 11, then be rewound to 10.`);

  await listener.end();
  await c1.end();
  await c2.end();
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  save();
  process.exit(0);
}
