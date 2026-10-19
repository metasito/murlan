// Usage: node integrate-check.mjs <INTEGRATED.md> <ledger.json> [--write]
import { readFileSync, writeFileSync } from "node:fs";

const [mdPath, ledgerPath] = process.argv.slice(2);
const write = process.argv.includes("--write");
let md = readFileSync(mdPath, "utf8");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));

const DROPPED = new Set(["L-018", "L-033", "L-045", "L-072", "L-079", "L-080", "L-092", "L-111", "L-151", "L-162", "L-193"]);
const DISPOSITIONS = {
  "L-090": "done at MAIN: #1603 landed `components/table/useTableExchange.ts`, `exchangeModel.exchangeNotes` (`components/table/exchangeModel.ts:139`), `tests/ui-rules/exchangeModel.test.ts`",
  "L-164": "no change: the platform-skip list fails safe and each entry carries its reason (`jest.config.js:380-387`); design 10 §7",
  "L-165": "no change: a suite-wide fake-timer default would change 100+ files' timing for no named defect; design 10 §7",
  "L-192": "no change: `record()` reads the ledger because billing needs prior rows (`loop-logs.mjs:304,333`); D25",
};

// ---- parse the ticket table
const sec3 = md.slice(md.indexOf("## 3. Final ticket table"), md.indexOf("## 4. Spec cards"));
const rows = sec3.split("\n").filter((l) => /^\| [A-Z]+-\d+ \|/.test(l));
const split = (l) => l.slice(1, -1).split(" | ").map((c) => c.trim());
const tickets = rows.map((l) => {
  const [id, title, area, size, ids, files, blocked, label, eye] = split(l);
  return { id, title, area, size, ids, files, blocked, label, eye };
});
const byId = new Map(tickets.map((t) => [t.id, t]));
const problems = [];

// Hand-set blocked-by (ticket part) overrides; external #issues are kept from the table.
const OVERRIDE = {}; // the hand-set edges are now in the table itself
const FILES_ADD = { "CLI-6": ", eslint.guards.cjs" };
for (const [id, add] of Object.entries(FILES_ADD)) if (!byId.get(id).files.includes(add.slice(2))) byId.get(id).files += add;
for (const [id, ds] of Object.entries(OVERRIDE)) {
  const t = byId.get(id);
  const ext = t.blocked.match(/#\d+/g) ?? [];
  t.blocked = [...ds, ...ext].join(", ") || "—";
}
// One priority order; every derived same-file edge points from earlier to later.
const ORDER = `LINT-1 HYG-1 HYG-3 HYG-2 ENG-2 TEST-1 TEST-8 SAVE-1 SRV-8 UI-1 UI-9 CLI-1 LOOP-1 NAT-2 HTTP-1
SRV-1 TURN-1 TIME-1 SRV-2 SRV-3 CLI-2 CLI-3 CLI-4 CLI-5 ENG-3 ENG-1 ENG-4 CLI-6 UI-2 ENG-5 SRV-4 SRV-7 ENG-6
SRV-5 SRV-6 ENG-7 SCEN-1 UI-3 UI-4 WORD-1 UI-5 UI-6 UI-7 LINT-2 LINT-3 TEST-2 LINT-4 TEST-3 TEST-4 TEST-5 TEST-6
HTTP-2 HTTP-3 HTTP-4 UI-8 CLI-7 WIRE-1 WIRE-3 WIRE-2 WIRE-4 WIRE-5 CLI-8 TIME-2 TIME-3 TURN-2 TURN-3 TEST-7 TEST-9
LOOP-2 LOOP-3 LOOP-4 LOOP-5 LOOP-6 LOOP-7 LOOP-8 LOOP-9 LOOP-10 LINT-5 NAT-1`.split(/\s+/);
const pos = new Map(ORDER.map((id, i) => [id, i]));
for (const t of tickets) if (!pos.has(t.id)) problems.push(`${t.id} missing from ORDER`);
if (pos.size !== ORDER.length) problems.push("ORDER has duplicates");
if (byId.size !== tickets.length) problems.push("duplicate ticket ids");

// ---- coverage
const kept = ledger.map((e) => e.id).filter((id) => !DROPPED.has(id));
const primary = new Map(), parts = new Map();
for (const t of tickets) {
  for (const m of t.ids.matchAll(/L-\d{3}( \(part\))?/g)) {
    const id = m[0].slice(0, 5), part = !!m[1];
    const map = part ? parts : primary;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(t.id);
    if (DROPPED.has(id)) problems.push(`${t.id} cites dropped ${id}`);
    if (!ledger.some((e) => e.id === id)) problems.push(`${t.id} cites unknown ${id}`);
  }
}
const missing = [], dup = [];
for (const id of kept) {
  const p = primary.get(id) ?? [];
  const d = DISPOSITIONS[id];
  if (p.length + (d ? 1 : 0) === 0) missing.push(id);
  if (p.length + (d ? 1 : 0) > 1) dup.push(`${id}: ${[...p, d ? "disposition" : null].filter(Boolean).join(", ")}`);
}
for (const id of parts.keys()) if (!primary.has(id) && !DISPOSITIONS[id]) problems.push(`${id} only cited as (part)`);

// ---- DAG
const deps = new Map(tickets.map((t) => [t.id, (t.blocked.match(/[A-Z]+-\d+/g) ?? [])]));
const external = new Map(tickets.map((t) => [t.id, (t.blocked.match(/#\d+/g) ?? [])]));
for (const [id, ds] of deps) for (const d of ds) if (!byId.has(d)) problems.push(`${id} blocked by unknown ${d}`);
const level = new Map(), onStack = new Set();
function lv(id) {
  if (level.has(id)) return level.get(id);
  if (onStack.has(id)) { problems.push(`cycle through ${id}`); return 0; }
  onStack.add(id);
  const ext = external.get(id).length ? 1 : 0;
  const v = Math.max(ext, ...deps.get(id).map((d) => lv(d) + 1));
  onStack.delete(id);
  level.set(id, v);
  return v;
}
tickets.forEach((t) => lv(t.id));
const anc = new Map();
function ancestors(id) {
  if (anc.has(id)) return anc.get(id);
  const s = new Set();
  for (const d of deps.get(id)) { s.add(d); ancestors(d).forEach((x) => s.add(x)); }
  anc.set(id, s);
  return s;
}
// critical path: longest chain by ticket count
const best = new Map();
function chain(id) {
  if (best.has(id)) return best.get(id);
  let c = [];
  for (const d of deps.get(id)) { const x = chain(d); if (x.length > c.length) c = x; }
  const r = [...c, id];
  best.set(id, r);
  return r;
}
let critical = [];
for (const t of tickets) { const c = chain(t.id); if (c.length > critical.length) critical = c; }
let critExt = [...new Set(critical.flatMap((id) => external.get(id)))];

// ---- file overlap
function expand(s) {
  const m = s.match(/^(.*?)\{([^}]*)\}(.*)$/);
  if (!m) return [s];
  return m[2].split(",").flatMap((x) => expand(m[1] + x + m[3]));
}
function filesOf(t) {
  const out = [];
  // split on commas not inside braces
  let depth = 0, cur = "";
  for (const ch of t.files) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out
    .map((x) => x.trim().replace(/\s*\(.*?\)\s*$/, "").split(/\s+/)[0])
    .filter((x) => x && /[\/.]/.test(x) && !x.startsWith("~"))
    .flatMap(expand)
    .map((x) => x.replace(/\/$/, "/"));
}
const F = new Map(tickets.map((t) => [t.id, filesOf(t)]));
const overlaps = (a, b) => a === b || (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b));
for (const [id, ds] of deps) for (const d of ds) if (pos.get(d) > pos.get(id)) problems.push(`edge ${d} -> ${id} contradicts ORDER`);
// derive same-file edges along ORDER, skipping any already implied
const added = [];
const sorted = [...tickets].sort((x, y) => pos.get(x.id) - pos.get(y.id));
for (let j = 0; j < sorted.length; j++) for (let i = j - 1; i >= 0; i--) {
  const a = sorted[i].id, b = sorted[j].id;
  anc.clear();
  if (ancestors(b).has(a)) continue;
  const share = F.get(a).some((x) => F.get(b).some((y) => overlaps(x, y)));
  if (!share) continue;
  deps.get(b).push(a);
  added.push(`${a} -> ${b}`);
}
anc.clear(); level.clear(); best.clear();
tickets.forEach((t) => lv(t.id));
for (const t of tickets) {
  const ext = external.get(t.id);
  t.blocked = [...deps.get(t.id), ...ext].join(", ") || "—";
}
critical = [];
for (const t of tickets) { const c = chain(t.id); if (c.length > critical.length) critical = c; }
critExt = [...new Set(critical.flatMap((id) => external.get(id)))];
const unordered = [];
for (let i = 0; i < tickets.length; i++) for (let j = i + 1; j < tickets.length; j++) {
  const a = tickets[i].id, b = tickets[j].id;
  if (ancestors(a).has(b) || ancestors(b).has(a)) continue;
  const shared = [];
  for (const x of F.get(a)) for (const y of F.get(b)) if (overlaps(x, y)) shared.push(x.length >= y.length ? x : y);
  if (shared.length) unordered.push(`${a} ~ ${b}: ${[...new Set(shared)].join(", ")}`);
}

// ---- totals
const count = (key) => tickets.reduce((m, t) => (m[t[key]] = (m[t[key]] ?? 0) + 1, m), {});
const bySize = count("size"), byArea = count("area");

// ---- report
const report = {
  tickets: tickets.length, bySize, byArea,
  keptIds: kept.length, mappedToTickets: kept.filter((id) => primary.has(id)).length,
  dispositions: Object.keys(DISPOSITIONS).length, missing, duplicates: dup, problems,
  criticalPath: critical, criticalExternal: critExt, maxLevel: Math.max(...level.values()),
  unorderedSharedFiles: unordered, derivedEdges: added,
};
console.log(JSON.stringify(report, null, 2));

if (write) {
  const waves = new Map();
  for (const t of tickets) { const l = level.get(t.id); if (!waves.has(l)) waves.set(l, []); waves.get(l).push(t.id); }
  const node = (id) => id.replace("-", "_");
  const graph = [
    "```mermaid", "graph TD",
    ...["#1624", "#1628", "#1639", "#1641"].map((e) => `  I${e.slice(1)}["${e}"]:::ext`),
    ...tickets.map((t) => `  ${node(t.id)}["${t.id} ${t.size}"]`),
    ...tickets.flatMap((t) => [
      ...deps.get(t.id).map((d) => `  ${node(d)} --> ${node(t.id)}`),
      ...external.get(t.id).map((e) => `  I${e.slice(1)} --> ${node(t.id)}`),
    ]),
    ...critical.slice(1).map((id, i) => `  linkStyle_placeholder_${i}`).filter(() => false),
    `  classDef ext fill:#eee,stroke:#999`,
    `  classDef crit stroke:#c00,stroke-width:3px`,
    `  class ${critical.map(node).join(",")} crit`,
    "```",
  ].join("\n");
  const waveLines = [...waves.keys()].sort((a, b) => a - b).map((l) =>
    `| ${l} | ${waves.get(l).join(", ")} |`);
  const g = [
    "Generated by `integrate-check.mjs` from the section 3 table (blocked-by column).",
    "",
    graph,
    "",
    `**Critical path (${critical.length} tickets, longest blocked-by chain; red in the graph):** ` +
      `${critExt.length ? critExt.join(", ") + " → " : ""}${critical.join(" → ")}.`,
    "",
    "**Waves.** A wave is a dependency depth; an external #issue counts as depth 0, so a ticket it blocks starts at",
    "wave 1. With one ticket at a time (R11), the queue takes the lowest open wave first and, inside a wave, the",
    "order stability → feel → rest (memory: queue order), i.e. SRV and the #1624/#1639 follow-ups before UI, UI",
    "before TEST/LINT/LOOP/HYG.",
    "",
    "| Wave | Tickets |",
    "|---|---|",
    ...waveLines,
  ].join("\n");
  const covRows = kept.map((id) => {
    const e = ledger.find((x) => x.id === id);
    const where = primary.get(id)?.join(", ") ?? DISPOSITIONS[id];
    const also = parts.get(id) ? ` (parts also in ${parts.get(id).join(", ")})` : "";
    return `| ${id} | ${where}${also} | ${e.verify.verdict} |`;
  });
  const cov = [
    "Mechanical check: `node integrate-check.mjs INTEGRATED.md phase0/ledger.verified.json` (beside this file).",
    "It parses the section 3 table and checks the following:",
    "",
    "- every kept ledger ID (238 − 11 dropped) maps to exactly one ticket's primary citation or to one",
    "  disposition below; a `(part)` citation alone does not count;",
    "- no ticket cites a dropped or unknown ID;",
    "- every blocked-by reference exists and the graph is acyclic;",
    "- every pair of tickets naming the same file (or one's directory) is ordered by a blocked-by path.",
    "",
    "**Result:**",
    `- ${kept.length} kept IDs: ${report.mappedToTickets} mapped to tickets and ${report.dispositions} by disposition.`,
    `- Missing: ${missing.length ? missing.join(", ") : "none"}.`,
    `- Duplicates: ${dup.length ? dup.join("; ") : "none"}.`,
    `- Other problems: ${problems.length ? problems.join("; ") : "none"}.`,
    `- Unordered pairs sharing a file: ${unordered.length ? unordered.length + " (listed below)" : "none"}.`,
    ...(unordered.length ? ["", ...unordered.map((u) => `  - ${u}`)] : []),
    "",
    "Dropped and not mapped: L-018 (absorbed into ENG-4/5/6 as un-export only), L-033, L-045, L-072",
    "(its `useRejoin` part lives in CLI-1), L-079, L-080, L-092 and L-111 (FIXED at MAIN), L-151 (WRONG),",
    "L-162 (WRONG; its `soak.yml` remnant rides in LOOP-8) and L-193.",
    "",
    "| Ledger ID | Ticket / disposition | Verify verdict |",
    "|---|---|---|",
    ...covRows,
  ].join("\n");
  const designs = { engine: 9, lastMove: 5, time: 5, "server-runtime": 5, "server-output": 5, http: 4, client: 8, "table-ui": 9, harness: 9, "static-checks": 5, loop: 11 };
  const tot = [
    "| Size | Count |", "|---|---|",
    ...["S", "M", "L", "XL"].map((s) => `| ${s} | ${bySize[s] ?? 0} |`),
    `| **Total** | **${tickets.length}** |`,
    "",
    "| Area | Count |", "|---|---|",
    ...Object.entries(byArea).map(([a, n]) => `| ${a} | ${n} |`),
    "",
    `The designs proposed ${Object.values(designs).reduce((a, b) => a + b, 0)} tickets: engine 9, lastMove 5, time 5,`,
    "server-runtime 5, server-output 5, http 4, client 8, table-ui 9, harness 9, static-checks 5 and loop 11. Six",
    `provisional hygiene and native groups bring that to 81. The earlier provisional count was 52. This plan has ${tickets.length}.`,
    "",
    `**Why the count moved (81 → ${tickets.length}, not 52).** Eight merges were made where two tickets edit the same`,
    "module for the same reason and still fit L:",
    "",
    "- time T3 into E5",
    "- E8 + S-OUT-5",
    "- S-OUT-1 + S-OUT-2",
    "- time T4 + harness T7",
    "- lastMove T4 + harness T9",
    "- C5a + C5b",
    "- loop T5a + T5b",
    "- L-234 into table-ui T7",
    "",
    "The hygiene items were spread into the tickets that already rewrite those lines. The earlier 52 assumed area-wide",
    "merges that would either exceed L (for example E5+E6+T1a, or the whole table-ui motion work) or join unrelated",
    "concerns, which the merging rule forbids.",
  ].join("\n");
  md = md.replace(/<!-- GEN:GRAPH -->[\s\S]*?(?=\n---\n\n## 6\.)/, () => `<!-- GEN:GRAPH -->\n${g}\n`)
    .replace(/<!-- GEN:COVERAGE -->[\s\S]*?(?=\n---\n\n## 8\.)/, () => `<!-- GEN:COVERAGE -->\n${cov}\n`)
    .replace(/<!-- GEN:TOTALS -->[\s\S]*$/, () => `<!-- GEN:TOTALS -->\n${tot}\n`);
  md = md.replace(/^\| ([A-Z]+-\d+) \|.*$/gm, (line, id) => {
    const t = byId.get(id);
    return t ? `| ${t.id} | ${t.title} | ${t.area} | ${t.size} | ${t.ids} | ${t.files} | ${t.blocked} | ${t.label} | ${t.eye} |` : line;
  });
  writeFileSync(mdPath, md);
}
