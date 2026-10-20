#!/usr/bin/env node
// node scripts/diagnostics-collector.mjs [out.ndjson] — the bench posts here on :5099 (docs/agents/checks.md).
import http from "node:http";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "./lib/entry.mjs";

export const MAX_BODY = 1024 * 1024;
export const MAX_FILE = 256 * 1024 * 1024;

const fileSize = (file) => (existsSync(file) ? statSync(file).size : 0);

export function createCollector(file, { maxFile = MAX_FILE } = {}) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return http.createServer((req, res) => {
    if (req.method === "GET") return res.end("ok");
    if (req.method !== "POST" || req.url !== "/log") {
      res.statusCode = 404;
      return res.end();
    }
    let body = "";
    let size = 0;
    let tooBig = false;
    const refuse = () => {
      if (tooBig) return;
      tooBig = true;
      body = "";
      res.statusCode = 413;
      res.setHeader("connection", "close");
      res.end(() => req.destroy());
    };
    if (Number(req.headers["content-length"]) > MAX_BODY) return refuse();
    req.on("data", (chunk) => {
      if (tooBig) return;
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY) return refuse();
      body += chunk;
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        const { session, seq, rows, dropped = 0 } = JSON.parse(body);
        if (!Array.isArray(rows) || !rows.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) {
          res.statusCode = 400;
          return res.end();
        }
        const lines = [{ session, seq, k: "batch", n: rows.length, dropped }, ...rows.map((row) => ({ session, seq, ...row }))];
        const text = lines.map((l) => JSON.stringify(l) + "\n").join("");
        if (fileSize(file) + Buffer.byteLength(text) > maxFile) {
          res.statusCode = 507;
          return res.end();
        }
        appendFileSync(file, text);
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
  createCollector(file).listen(5099, "0.0.0.0", () => console.log(`• Diagnostics collector on every interface, :5099 (the phone must reach it) → ${file}`));
}
