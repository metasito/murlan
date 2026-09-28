#!/usr/bin/env node
// node scripts/diagnostics-collector.mjs [out.ndjson] — the bench posts here on :5099 (docs/agents/checks.md).
import http from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "./lib/entry.mjs";

export function createCollector(file) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return http.createServer((req, res) => {
    if (req.method === "GET") return res.end("ok");
    if (req.method !== "POST" || req.url !== "/log") {
      res.statusCode = 404;
      return res.end();
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { session, seq, rows, dropped = 0 } = JSON.parse(body);
        const lines = [{ session, seq, k: "batch", n: rows.length, dropped }, ...rows.map((row) => ({ session, seq, ...row }))];
        appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
        res.end("ok");
      } catch {
        res.statusCode = 400;
        res.end();
      }
    });
  });
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const file = process.argv[2] ?? path.join("diagnostics", `${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`);
  createCollector(file).listen(5099, "0.0.0.0", () => console.log(`• Diagnostics collector on :5099 → ${file}`));
}
