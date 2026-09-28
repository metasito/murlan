// [RESEARCH-1259] never merged. Receives the soak rows and appends them, one JSON row per line.
import http from "node:http";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), process.argv[2] ?? "device-log.ndjson");
let batches = 0;
http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method !== "POST") return res.end("ok");
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        const { session, seq, rows } = JSON.parse(body);
        appendFileSync(out, rows.map((r) => JSON.stringify({ s: session, q: seq, ...r })).join("\n") + "\n");
        if (++batches % 10 === 1) console.log(`${new Date().toISOString()} batch ${seq} from ${session}: ${rows.length} rows`);
      } catch (e) {
        console.error("bad batch", e.message);
      }
      res.end("ok");
    });
  })
  .listen(5099, "0.0.0.0", () => console.log(`collector on :5099 -> ${out}`));
