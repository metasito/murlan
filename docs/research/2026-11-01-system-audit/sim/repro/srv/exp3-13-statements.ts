// Claims 3 and 13 from the statement log (log_statement=all on murlan_repro_srv only). One instance.
// Counts statement shapes only; parameter values are never read or printed. Friend notices are
// counted on the cluster channel (RedisTap), now that they no longer travel as pg_notify.
import {
  bootInstance, connect, countShapes, killInstance, logOffset, out, PidWatch, q,
  readStatements, RedisTap, register, resetData, sleep, tally, waitForPeers, type Instance, type LogStatement,
} from "./lib.ts";

const { log, save } = out("exp3-13.txt");
let A: Instance | undefined;
const pids = new PidWatch();
const tap = new RedisTap();

async function measure(label: string, work: () => Promise<void>): Promise<LogStatement[]> {
  await pids.sample();
  const offset = logOffset();
  await work();
  await sleep(1_500);
  await pids.sample();
  const stmts = readStatements(offset, pids.pids);
  log(`\n-- ${label}: ${stmts.length} statements`);
  for (const [shape, n] of countShapes(stmts).slice(0, 10)) log(`   ${String(n).padStart(4)}  ${shape}`);
  return stmts;
}

const count = (stmts: LogStatement[], re: RegExp) => stmts.filter((s) => re.test(s.sql)).length;
const SESSION_SELECT = /select\s+sess\s+from/i;
const SESSION_TOUCH = /update\s+"?(public"?\.)?"?session"?\s+set\s+"?expire/i;
const EVENT_INSERT = /insert into "?events"?/i;
const NOTIFY = /pg_notify/i;

try {
  await q("ALTER DATABASE murlan_repro_srv SET log_statement = 'all'");
  await resetData();
  await tap.start();
  A = await bootInstance("srvA", 5581, { env: { MURLAN_WEB_DIST: "docs/research/2026-11-01-system-audit/sim/repro/srv/stub-dist" } });
  await waitForPeers(tap, 1);
  await pids.start(100);
  const tag = Date.now().toString(36);
  let me = { cookie: "", id: "" };
  // The statement-log positive control: a registration's writes, which the reader must attribute to A.
  const control = await measure("positive control, one registration", async () => {
    me = await register(A!.url, `s${tag}`);
  });
  if (count(control, /insert into "users"/i) === 0) throw new Error("the statement log showed no INSERT of A's: PGLOG or log_statement is wrong");

  log("# exp3: static files with and without a session cookie (10 requests each)");
  const get = (path: string, cookie?: string) =>
    fetch(`${A!.url}${path}`, { headers: cookie ? { cookie } : {} }).then((r) => r.arrayBuffer().then(() => r.status));
  const cases: [string, string, boolean][] = [
    ["/assets image, cookie", "/assets/images/favicon.png", true],
    ["/assets image, no cookie", "/assets/images/favicon.png", false],
    ["dist hashed bundle, cookie", "/entry-0123456789abcdef0123456789abcdef.js", true],
    ["dist hashed bundle, no cookie", "/entry-0123456789abcdef0123456789abcdef.js", false],
    ["API GET /api/auth/me, cookie", "/api/auth/me", true],
  ];
  const table: string[] = [];
  for (const [label, path, withCookie] of cases) {
    const statuses: number[] = [];
    const s = await measure(label, async () => {
      for (let i = 0; i < 10; i++) statuses.push(await get(path, withCookie ? me.cookie : undefined));
    });
    table.push(`${label.padEnd(32)} status ${[...new Set(statuses)].join("/")}  session SELECT ${count(s, SESSION_SELECT)}  touch UPDATE ${count(s, SESSION_TOUCH)}  total ${s.length}`);
  }
  log("\nsummary (10 requests per row):");
  for (const row of table) log("  " + row);

  log("\n# exp13: telemetry INSERTs per socket session, friend-status NOTIFYs per friend");
  const friends: { id: string }[] = [];
  for (let i = 0; i < 20; i++) friends.push(await register(A.url, `f${tag}${i}`));
  const subjects: { label: string; n: number; user: { id: string; cookie: string } }[] = [];
  for (const n of [0, 5, 20]) {
    const user = await register(A.url, `u${n}${tag}`);
    for (const f of friends.slice(0, n)) {
      await q(
        `INSERT INTO friends (user_id, friend_user_id, status) VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')`,
        [user.id, f.id]
      );
    }
    subjects.push({ label: `${n} friends (all offline)`, n, user });
  }
  const rows: string[] = [];
  for (const { label, n, user } of subjects) {
    const mark = tap.mark();
    const eventsBefore = (await q<{ n: number }>("SELECT count(*)::int n FROM events"))[0]!.n;
    const s = await measure(`one socket session, ${label}`, async () => {
      const socket = await connect(A!.url, user.cookie, "web");
      socket.emit("friend:get_online_list");
      await sleep(800);
      socket.close();
      await sleep(1_200);
    });
    const heard = tap.since(mark);
    const eventRows = (await q<{ n: number }>("SELECT count(*)::int n FROM events"))[0]!.n - eventsBefore;
    rows.push(`friends=${String(n).padStart(2)}: events rows ${eventRows} in ${count(s, EVENT_INSERT)} INSERT statements, pg_notify ${count(s, NOTIFY)}, cluster messages ${heard.length} ${JSON.stringify(Object.fromEntries(Object.entries(tally(heard)).map(([k, v]) => [k, v.n])))}`);
  }
  log("\nsummary (connect, list, disconnect; single instance):");
  for (const r of rows) log("  " + r);
  const ev = await q<{ name: string; n: number }>("SELECT name, count(*)::int n FROM events GROUP BY name ORDER BY name");
  log("events table after the run:", ev);
} catch (err) {
  log("FAILED", String((err as Error).stack ?? err));
} finally {
  if (A) await killInstance(A);
  await tap.stop().catch(() => {});
  await pids.stop().catch(() => {});
  await q("ALTER DATABASE murlan_repro_srv RESET log_statement").catch(() => {});
  save();
  process.exit(0);
}
