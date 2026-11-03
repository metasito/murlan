// bench.sh's raw.csv as a markdown table: per engine and case, the median of the runs' requests a
// second, their spread (min-max), and the median of the runs' p50 and p99 latency.
// Usage: node summarize.mjs <raw.csv>
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const [engine, name, run, ...rest] = line.split(",");
    const cells = rest.join(",").match(/"[^"]*"/g).map((c) => c.slice(1, -1));
    const [, rps, , , p50, , p99] = cells.map(Number);
    return { engine, name, run, rps, p50, p99 };
  });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const groups = new Map();
for (const r of rows) {
  const key = `${r.name}\t${r.engine}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
console.log("| case | engine | runs | req/s median | req/s spread | p50 ms | p99 ms |");
console.log("|---|---|---|---|---|---|---|");
for (const [key, rs] of [...groups].sort()) {
  const [name, engine] = key.split("\t");
  const rps = rs.map((r) => r.rps);
  console.log(
    `| ${name} | ${engine} | ${rs.length} | ${Math.round(median(rps))} | ${Math.round(Math.min(...rps))}-${Math.round(Math.max(...rps))} | ` +
      `${median(rs.map((r) => r.p50)).toFixed(3)} | ${median(rs.map((r) => r.p99)).toFixed(3)} |`,
  );
}
