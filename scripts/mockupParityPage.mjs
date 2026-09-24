#!/usr/bin/env node
// Builds the side-by-side page of tests/e2e/mockupParity.spec.ts (#1255): per moment, the mockup
// and the real table in step, a scrubber by time since onset, a flip toggle, the traces overlaid
// and the failing checkpoints marked.
//   node scripts/mockupParityPage.mjs <input> <out-dir>
// <input> is a local run's tests/e2e/test-results, or a Playwright HTML report, e.g. from
// `gh run download <run> -n playwright-report`.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function walk(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

const sha1 = (file) => createHash("sha1").update(fs.readFileSync(file)).digest("hex");

/** Every moment the input holds, each with its frames resolved to files on disk. */
export function findMoments(input) {
  const files = walk(input);
  const bySha = new Map();
  const moments = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    let parity;
    try {
      parity = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (parity?.murlanParity !== 1) continue;
    for (const side of Object.values(parity.sides)) {
      for (const frame of side.frames) {
        let source = path.join(path.dirname(file), frame.file);
        if (!fs.existsSync(source)) {
          if (bySha.size === 0) for (const f of files.filter((f) => f.endsWith(".jpg"))) bySha.set(sha1(f), f);
          source = bySha.get(frame.sha1);
        }
        if (!source) throw new Error(`${parity.moment}: no file for ${frame.file} (sha1 ${frame.sha1}) under ${input}`);
        frame.source = source;
      }
    }
    moments.push(parity);
  }
  if (moments.length === 0) throw new Error(`no parity.json under ${input} — run tests/e2e/mockupParity.spec.ts first`);
  return moments;
}

export function buildPage(moments, out) {
  fs.mkdirSync(out, { recursive: true });
  const data = moments.map((m) => {
    const sides = {};
    for (const [name, side] of Object.entries(m.sides)) {
      const frames = side.frames.map((f) => {
        const rel = `${m.moment}/${path.basename(f.file)}`;
        fs.mkdirSync(path.join(out, m.moment), { recursive: true });
        fs.copyFileSync(f.source, path.join(out, rel));
        return { t: f.t, src: rel };
      });
      sides[name] = { frames, trace: side.trace };
    }
    return { moment: m.moment, mode: m.mode, checkpoints: m.checkpoints, failures: m.failures, sides };
  });
  const html = PAGE.replace("__DATA__", () => JSON.stringify(data).replace(/</g, "\\u003c"));
  fs.writeFileSync(path.join(out, "index.html"), html);
  return path.join(out, "index.html");
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mockup parity</title>
<style>
body{margin:0;padding:20px;background:#0b0f0d;color:#e8e2cf;font:14px/1.45 system-ui,sans-serif}
h2{margin:28px 0 8px;font-size:18px}.row{display:flex;gap:12px;flex-wrap:wrap}
figure{margin:0}figcaption{font-size:12px;opacity:.7;margin-bottom:4px}
img{width:437px;height:201px;display:block;border:1px solid #333;background:#000}
.bar{display:flex;gap:12px;align-items:center;margin:10px 0}.bar input[type=range]{flex:1}
.ticks{position:relative;height:8px;margin:0 6px}.ticks i{position:absolute;top:0;width:2px;height:8px;background:#e5484d}
svg{background:#111814;border:1px solid #2a332e;margin:4px 8px 4px 0}svg text{fill:#9aa39d;font-size:10px}
.fail{color:#ff8b8e;cursor:pointer}.legend b{display:inline-block;width:18px;height:3px;vertical-align:middle;margin:0 4px}
</style></head><body>
<h1>The real table beside its mockup</h1>
<p class="legend"><b style="background:#e9c46a"></b>mockup <b style="background:#6ec6ff"></b>app · red: a checkpoint outside tolerance</p>
<div id="root"></div>
<script>
  const DATA = __DATA__;
  const SERIES = {
    live: (f) => f.live, dropped: (f) => f.dropped,
    "lamp x": (f) => f.lamp && f.lamp.x, "lamp y": (f) => f.lamp && f.lamp.y,
    level: (f) => f.lamp && f.lamp.level, flare: (f) => f.lamp && f.lamp.flare,
    shake: (f) => f.shake && Math.hypot(f.shake.x, f.shake.y),
  };
  function chart(name, sides, read, span, fails) {
    const W = 280, H = 90, pts = {};
    let lo = Infinity, hi = -Infinity;
    for (const [s, rows] of Object.entries(sides)) {
      pts[s] = rows.map((r) => [r.t, read(r)]).filter(([, v]) => v !== null && v !== undefined);
      for (const [, v] of pts[s]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (lo === Infinity) { lo = 0; hi = 1; }
    if (hi === lo) { hi += 0.5; lo -= 0.5; }
    const x = (t) => (t / span) * (W - 10) + 5, y = (v) => H - 14 - ((v - lo) / (hi - lo)) * (H - 26);
    const line = (s, c) => '<polyline fill="none" stroke="' + c + '" stroke-width="1.5" points="' + pts[s].map(([t, v]) => x(t) + "," + y(v)).join(" ") + '"/>';
    const marks = fails.map((t) => '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="0" y2="' + H + '" stroke="#e5484d" stroke-width="1"/>').join("");
    return '<svg width="' + W + '" height="' + H + '"><text x="5" y="11">' + name + " (" + lo.toFixed(1) + "–" + hi.toFixed(1) + ")</text>" + marks + line("mockup", "#e9c46a") + line("app", "#6ec6ff") + "</svg>";
  }
  for (const m of DATA) {
    const el = document.createElement("section");
    const span = Math.max(...m.sides.mockup.frames.map((f) => f.t));
    const failsFor = (field) => m.failures.filter((f) => f.field === field).map((f) => f.t);
    let charts = "";
    for (const [name, read] of Object.entries(SERIES)) {
      const field = name.startsWith("lamp") ? "lamp" : name;
      charts += chart(name, { mockup: m.sides.mockup.trace.frames, app: m.sides.app.trace.frames }, read, span, failsFor(field));
    }
    for (const region of Object.keys(m.sides.mockup.trace.regions[0]?.regions ?? {})) {
      const rows = (s) => m.sides[s].trace.regions.map((r) => ({ t: r.t, v: r.regions[region] }));
      const fails = m.failures.filter((f) => f.field === "brightness" && f.message.startsWith(region + " ")).map((f) => f.t);
      charts += chart("brightness · " + region, { mockup: rows("mockup"), app: rows("app") }, (r) => r.v, span, fails);
    }
    const failTimes = [...new Set(m.failures.map((f) => f.t))].filter((t) => t >= 0 && t <= span);
    el.innerHTML = "<h2>" + m.moment + " <small>(" + m.mode + " mode, " + m.failures.length + " failing checks)</small></h2>" +
      '<div class="row"><figure><figcaption>mockup</figcaption><img class="a"></figure><figure><figcaption>app</figcaption><img class="b"></figure>' +
      '<figure><figcaption class="fc">flip: mockup</figcaption><img class="c"></figure></div>' +
      '<div class="bar"><button class="play">Play</button><button class="flip">Flip</button><input type="range" min="0" max="' + span + '" step="' + (m.sides.mockup.frames[1]?.t ?? 16) + '" value="0"><span class="t">0 ms</span></div>' +
      '<div class="ticks">' + failTimes.map((t) => '<i style="left:' + (t / span) * 100 + '%"></i>').join("") + "</div>" +
      '<div class="row">' + charts + "</div>" +
      "<details><summary>" + m.failures.length + " failing checks</summary>" + m.failures.map((f) => '<div class="fail" data-t="' + f.t + '">' + f.t + " ms · " + f.field + " · " + f.message + "</div>").join("") + "</details>";
    document.getElementById("root").append(el);
    const [a, b, c] = ["a", "b", "c"].map((k) => el.querySelector("img." + k));
    const range = el.querySelector("input"), label = el.querySelector(".t"), fc = el.querySelector(".fc");
    let flipped = false, playing = false, t0 = 0;
    const at = (side, t) => { const fr = m.sides[side].frames; let best = fr[0]; for (const f of fr) if (f.t <= t) best = f; return best.src; };
    const show = (t) => { range.value = t; label.textContent = t + " ms"; a.src = at("mockup", t); b.src = at("app", t); c.src = at(flipped ? "app" : "mockup", t); fc.textContent = "flip: " + (flipped ? "app" : "mockup"); };
    range.oninput = () => show(+range.value);
    el.querySelector(".flip").onclick = () => { flipped = !flipped; show(+range.value); };
    el.querySelectorAll(".fail").forEach((d) => (d.onclick = () => show(+d.dataset.t)));
    el.querySelector(".play").onclick = () => {
      playing = !playing;
      t0 = performance.now() - +range.value;
      const tick = (now) => { if (!playing) return; const t = Math.round((now - t0) % (span + 1)); show(t - (t % 16)); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    show(0);
  }
</script></body></html>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, out] = process.argv.slice(2);
  if (!input || !out) {
    console.error("usage: mockupParityPage.mjs <test-results or playwright-report dir> <out-dir>");
    process.exit(2);
  }
  console.log(buildPage(findMoments(input), out));
}
