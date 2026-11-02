// What `/metrics` exposes, by sample name, type and label names, is pinned: a dashboard or alert
// keyed on it breaks silently when a metrics library changes what it writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "prom-client";
import { noteStreamRead } from "../../server/shared/metrics.ts";
import "../../server/http/rateLimit.ts";
import { createPool } from "../../server/store/pool.ts";

type Exposed = Record<string, { type: string; help: string; samples: Record<string, string[]> }>;

function parse(text: string): Exposed {
  const exposed: Exposed = {};
  const family = (name: string) => (exposed[name] ??= { type: "", help: "", samples: {} });
  for (const line of text.split("\n")) {
    if (!line) continue;
    const meta = /^# (HELP|TYPE) (\S+) (.*)$/.exec(line);
    if (meta) {
      family(meta[2]!)[meta[1] === "HELP" ? "help" : "type"] = meta[3]!;
      continue;
    }
    const sample = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})? \S+$/.exec(line);
    assert.ok(sample, `not an exposition line: ${line}`);
    const labels = [...(sample[2] ?? "").matchAll(/(\w+)="/g)].map((m) => m[1]!).sort();
    const owner = Object.keys(exposed).filter((name) => sample[1]!.startsWith(name)).sort((a, b) => b.length - a.length)[0];
    assert.ok(owner, `sample before its family: ${line}`);
    family(owner).samples[sample[1]!] = labels;
  }
  return exposed;
}

test("/metrics exposes the recorded names, types and labels", async () => {
  const pool = createPool("app");
  try {
    noteStreamRead("adapter", `${Date.now()}-0`);
    noteStreamRead("inbox", `${Date.now()}-0`);
    for (const [name, label] of [
      ["redis_reconnects_total", "use"],
      ["cluster_messages_total", "channel"],
      ["limiter_fallbacks_total", "limiter"],
    ] as const) {
      (register.getSingleMetric(name) as unknown as { inc(labels: Record<string, string>): void }).inc({ [label]: "x" });
    }
    const recorded: Exposed = JSON.parse(readFileSync("tests/fixtures/metricsExposition.json", "utf8"));
    assert.equal(register.contentType, "text/plain; version=0.0.4; charset=utf-8");
    assert.deepEqual(parse(await register.metrics()), recorded);
  } finally {
    await pool.end();
  }
});
