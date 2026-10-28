#!/usr/bin/env node
// node scripts/diagnostics-verdict.mjs <run.ndjson> <scenario|all> — exits 1 unless every named gate passed.
// node scripts/diagnostics-verdict.mjs --flinger <start.txt> <end.txt> — the audio_flinger underrun gate (#1231).
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "./lib/entry.mjs";
import { LAMP_FLOOR, LAMP_SIDES, LAMP_SWAY, LAMP_SYMMETRY, evenness } from "../lib/diagnostics/lampLegibility.ts";
import { noticeBlink } from "../components/table/noticeModel.ts";

function slopePerMinute(points) {
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  const sxy = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const sxx = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return sxx === 0 ? NaN : sxy / sxx;
}

function fit(points) {
  const slope = slopePerMinute(points);
  const mx = points.reduce((a, [x]) => a + x, 0) / points.length;
  const my = points.reduce((a, [, y]) => a + y, 0) / points.length;
  return (x) => my + slope * (x - mx);
}

function soak(rows) {
  const t0 = rows[0].t;
  const t1 = rows.at(-1).t;
  const minutes = (t1 - t0) / 60000;
  const memory = rows.filter((r) => r.k === "footprint" && r.t - t0 >= 5 * 60000).map((r) => [(r.t - t0) / 60000, r.mb]);
  const engine = rows.filter((r) => r.k === "engine");
  const lag = engine.map((r) => [(r.t - t0) / 60000, r.audioMs - r.t]);
  const line = lag.length >= 2 ? fit(lag) : () => NaN;
  const residual = lag.map(([x, y]) => y - line(x));
  const jumps = engine.slice(1).filter((_, i) => !(Math.abs(residual[i + 1] - residual[i]) <= 20)).map((r) => r.t);
  const mid = (t0 + t1) / 2;
  const firstHalf = jumps.filter((t) => t < mid).length;
  const secondHalf = jumps.length - firstHalf;
  const notRunning = engine.filter((r) => r.state !== "running").length;
  const plays = rows.filter((r) => r.k === "play" && !r.dropped).length;
  const mbPerMin = memory.length >= 10 ? slopePerMinute(memory) : NaN;
  const pass =
    minutes >= 29 && mbPerMin < 1 && secondHalf <= firstHalf && notRunning === 0 && engine.length >= minutes * 5 && plays >= minutes * 45;
  return { pass, metrics: { minutes, mbPerMin, driftMsPerMin: slopePerMinute(lag), firstHalf, secondHalf, notRunning, plays, samples: engine.length } };
}

function smoke(rows) {
  const engine = rows.filter((r) => r.k === "engine");
  const first = engine[0];
  const last = engine.at(-1);
  const advance = engine.length >= 2 ? (last.audioMs - first.audioMs) / (last.t - first.t) : 0;
  const running = engine.length > 0 && engine.every((r) => r.state === "running");
  const pass = engine.length >= 5 && running && advance >= 0.9;
  return { pass, metrics: { samples: engine.length, running, advance, ...(pass ? {} : { error: "no audio device" }) } };
}

const UNDERRUNS = /underrun counters: partial=(\d+) empty=(\d+)/g;

export function flingerUnderruns(text) {
  const counts = [...text.matchAll(UNDERRUNS)].map((m) => Number(m[1]) + Number(m[2]));
  return counts.length === 0 ? null : counts.reduce((a, b) => a + b, 0);
}

export function flingerVerdict(startText, endText) {
  const start = flingerUnderruns(startText);
  const end = flingerUnderruns(endText);
  const growth = start === null || end === null ? null : end - start;
  return { pass: growth !== null && growth <= 60, metrics: { start, end, growth } };
}

// A NaN breaks Array.sort's ordering and makes a median finite garbage, so non-finite values are dropped first.
const ordered = (xs) => xs.filter(Number.isFinite).sort((a, b) => a - b);
const median = (xs) => {
  const s = ordered(xs);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const p90 = (xs) => {
  const s = ordered(xs);
  return s.length ? s[Math.ceil(s.length * 0.9) - 1] : NaN;
};

const midMedian = (xs) => {
  const s = ordered(xs);
  const m = s.length / 2;
  return s.length === 0 ? NaN : s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};

export function medianHz(rows) {
  const perSecond = new Map();
  for (const r of rows) {
    if (r.k !== "frame" || !(r.dt > 0)) continue;
    const s = Math.floor(r.t / 1000);
    if (!perSecond.has(s)) perSecond.set(s, []);
    perSecond.get(s).push(1000 / r.dt);
  }
  return midMedian([...perSecond.values()].map(midMedian));
}

const framesOf = (rows) => rows.filter((r) => r.k === "frame" && r.dt > 0);

/** Frames per second as presented: n over the time they took. A median of per-second medians snaps to the display rate however many frames missed it. */
export function meanHz(rows) {
  const f = framesOf(rows);
  const ms = f.reduce((sum, r) => sum + r.dt, 0);
  return f.length && ms > 0 ? (f.length * 1000) / ms : NaN;
}

// A hitch is a frame that missed its refresh while its neighbours made theirs. The worklets governor steps the rate down on purpose, and a whole stretch at 12.5 or 25 ms is a lower rate, not a hitch.
const HITCH_RATIO = 1.6;
const HITCH_NEIGHBOURS = 4;
const HITCH_CALM_MS = 11;
const HITCH_MIN_MS = 12;

export function hitches(rows) {
  const dts = framesOf(rows).map((r) => r.dt);
  let count = 0;
  for (let i = 0; i < dts.length; i++) {
    if (dts[i] < HITCH_MIN_MS) continue;
    const near = [];
    for (let j = Math.max(0, i - HITCH_NEIGHBOURS); j <= Math.min(dts.length - 1, i + HITCH_NEIGHBOURS); j++) if (j !== i) near.push(dts[j]);
    const m = median(near);
    if (m < HITCH_CALM_MS && dts[i] >= HITCH_RATIO * m) count++;
  }
  const seconds = dts.reduce((sum, d) => sum + d, 0) / 1000;
  return { count, perSecond: seconds > 0 ? count / seconds : NaN };
}

const times = (rows, k, name) => rows.filter((r) => r.k === k && (name === undefined || r.name === name)).map((r) => r.t);
const firstIn = (times, from, to) => times.filter((t) => t >= from && t <= to).sort((a, b) => a - b)[0];
const onsetsOf = (rows, source) => rows.filter((r) => r.k === "onset" && r.source === source).map((r) => r.t);

function armRows(rows, name) {
  const start = rows.findIndex((r) => r.k === "arm" && r.name === name && r.phase === "start");
  const end = rows.findIndex((r, i) => i > start && r.k === "arm" && r.name === name && r.phase === "end");
  return start === -1 || end === -1 ? [] : rows.slice(start, end + 1);
}

// Each onset answers one window, so a silent trigger cannot borrow its neighbour's.
function matchOnsets(starts, onsets, windowMs) {
  const sorted = [...onsets].sort((a, b) => a - b);
  const used = new Set();
  return starts.map((s) => {
    const i = sorted.findIndex((o, j) => !used.has(j) && o >= s && o < s + windowMs);
    if (i === -1) return null;
    used.add(i);
    return sorted[i];
  });
}

export function burstStalls(rows) {
  const frames = rows.filter((r) => r.k === "frame" && r.dt > 0);
  const spans = [...frames, ...rows.filter((r) => r.k === "jsLag")]
    .filter((r) => r.dt >= 34)
    .map((r) => [r.t - r.dt, r.t])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s[0] - last[1] <= 100) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const perWindow = new Map();
  for (const f of frames) perWindow.set(Math.floor(f.t / 250), (perWindow.get(Math.floor(f.t / 250)) ?? 0) + 1);
  const counts = [...perWindow.values()];
  const jsTicks = rows.filter((r) => r.k === "jsTicks").reduce((n, r) => n + r.n, 0);
  return {
    stalls: merged.length,
    fastShare: counts.length ? counts.filter((n) => n * 4 >= 100).length / counts.length : 0,
    frames: frames.length,
    jsTicks,
  };
}

function tapBurst(rows) {
  const on = armRows(rows, "on");
  const latency = rows.find((r) => r.k === "latency");
  const lead = (latency?.outputMs ?? NaN) + (latency?.ioMs ?? NaN) / 2;
  const taps = times(on, "trigger", "tap");
  const matched = matchOnsets(taps, onsetsOf(on, "app"), 150);
  const heard = taps.flatMap((t, i) => (matched[i] === null ? [] : [matched[i] - t + lead]));
  const plays = on.filter((r) => r.k === "play" && !r.dropped).length;
  const missing = matched.filter((m) => m === null).length;
  const b = burstStalls(on);
  const off = burstStalls(armRows(rows, "off"));
  const metrics = { taps: taps.length, plays, missing, ...b, stallsOff: off.stalls, fastShareOff: off.fastShare, tapToHeardP90: p90(heard), leadMs: lead };
  const pass =
    taps.length === 60 && plays >= 60 && missing === 0 && b.frames > 0 && b.jsTicks > 0 &&
    b.stalls === 0 && b.fastShare >= 0.8 && p90(heard) <= 40;
  return { pass, metrics };
}

function scheduledOnset(rows) {
  const latency = rows.find((r) => r.k === "latency");
  const inputMs = latency?.inputMs ?? NaN;
  const lead = median(rows.filter((r) => r.k === "play" && !r.dropped).map((r) => r.lead));
  const triggers = times(rows, "trigger", "scheduled");
  const mic = matchOnsets(triggers.map((at) => at - 100), onsetsOf(rows, "mic").map((t) => t - inputMs), 300);
  const app = matchOnsets(triggers.map((at) => at - lead - 100), onsetsOf(rows, "app"), 300);
  const errors = triggers.flatMap((at, i) => (mic[i] === null ? [] : [mic[i] - at]));
  const appErrors = triggers.flatMap((at, i) => (app[i] === null ? [] : [app[i] - (at - lead)]));
  const metrics = {
    scheduled: triggers.length, matched: errors.length, absP90: p90(errors.map(Math.abs)), medianErr: median(errors),
    appAbsP90: p90(appErrors.map(Math.abs)), appMedianErr: median(appErrors),
    outputMs: latency?.outputMs ?? null, ioMs: latency?.ioMs ?? null, inputMs: latency?.inputMs ?? null, leadMs: lead,
  };
  return { pass: triggers.length === 40 && errors.length === 40 && p90(errors.map(Math.abs)) <= 25, metrics };
}

function pulseCost(rows) {
  const costs = rows.filter((r) => r.k === "pulseCost");
  const cold = costs.find((r) => r.cold)?.ms ?? NaN;
  const warm = costs.filter((r) => !r.cold).map((r) => r.ms);
  return { pass: warm.length === 20 && cold <= 8.33 && p90(warm) <= 1, metrics: { coldMs: cold, warmP90Ms: p90(warm), warm: warm.length } };
}

function hapticOnset(rows) {
  const pulses = times(rows, "trigger", "pulse");
  const shakes = times(rows, "shake");
  const lags = pulses.flatMap((p) => {
    const s = firstIn(shakes, p, p + 150);
    return s === undefined ? [] : [s - p];
  });
  const metrics = { pulses: pulses.length, matched: lags.length, p90: p90(lags), missing: pulses.length - lags.length };
  return { pass: pulses.length === 30 && lags.length === 30 && p90(lags) <= 40, metrics };
}

function musicSwitch(rows) {
  const switches = rows.filter((r) => r.k === "trigger" && r.name === "switch");
  const from = switches[0]?.t ?? Infinity;
  const levels = rows.filter((r) => r.k === "level" && r.t >= from).sort((a, b) => a.t - b.t);
  let quiet = 0;
  let gaps = 0;
  let deaths = 0;
  const close = () => {
    if (quiet > 250) gaps++;
    if (quiet >= 2000) deaths++;
    quiet = 0;
  };
  for (const l of levels) {
    if (l.db < -50) quiet += 50;
    else close();
  }
  close();
  const level = median(levels.map((l) => l.db));
  const metrics = { switches: switches.length, levels: levels.length, medianDb: level, gaps, deaths };
  return { pass: switches.length === 40 && levels.length >= 1900 && level > -40 && gaps === 0 && deaths === 0, metrics };
}

// The scenario sleeps 5 s; a frame loop that ran for less than 4 s of it has measured nothing.
const IDLE_MIN_MS = 4000;

function idle(rows) {
  const f = framesOf(rows);
  const coveredMs = f.reduce((sum, r) => sum + r.dt, 0);
  return { pass: coveredMs >= IDLE_MIN_MS, metrics: { frames: f.length, coveredMs, hz: meanHz(rows) } };
}

function landingSync(rows) {
  const lead = median(rows.filter((r) => r.k === "play" && !r.dropped).map((r) => r.lead));
  const contacts = times(rows, "trigger", "flightContact");
  const heard = matchOnsets(contacts.map((c) => c - lead - 150), onsetsOf(rows, "app"), 300);
  const offsets = contacts.flatMap((c, i) => (heard[i] === null ? [] : [heard[i] + lead - c]));
  const misses = contacts.length - offsets.length;
  const absP90 = p90(offsets.map(Math.abs));
  return {
    pass: contacts.length >= 40 && misses === 0 && absP90 <= 20,
    metrics: { contacts: contacts.length, misses, absP90, medianErr: median(offsets), leadMs: lead },
  };
}

function seatAnchors(rows) {
  const states = rows.filter((r) => r.k === "seatState").sort((a, b) => a.t - b.t);
  const ofs = new Set(states.map((s) => s.of));
  const of = ofs.size === 1 ? [...ofs][0] : NaN;
  const judged = rows.filter((r) => r.k === "ring" && r.t >= (states[0]?.t ?? Infinity)).sort((a, b) => a.t - b.t);
  const rings = judged.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
  const held = (s) => rings.filter((r) => r.t >= s.t && r.t < s.t + s.hold);
  const home = new Map();
  for (const r of states.length ? held(states[0]) : []) if (!home.has(r.name)) home.set(r.name, r);
  const distinct = new Set([...home.values()].map((h) => `${h.x},${h.y}`)).size === home.size;
  const drift = rings.reduce((d, r) => {
    const h = home.get(r.name);
    return h ? Math.max(d, Math.abs(r.x - h.x), Math.abs(r.y - h.y)) : d;
  }, 0);
  const unmeasured = states.filter((s) => {
    const seen = new Set(held(s).map((r) => r.name));
    return [...home.keys()].some((name) => !seen.has(name));
  }).length;
  const recorded = new Set(states.map((s) => s.id)).size;
  const invalid = judged.length - rings.length;
  const badHold = states.filter((s, i) => !(Number.isFinite(s.hold) && s.hold > 0 && s.hold <= (states[i + 1]?.t ?? Infinity) - s.t)).length;
  const zeroed = rings.filter((r) => r.x === 0 && r.y === 0).length;
  return {
    pass:
      home.size === 3 && distinct && invalid === 0 && badHold === 0 && zeroed === 0 && of >= 2 && states.length === of && recorded === of &&
      unmeasured === 0 && drift <= 0.5,
    metrics: { drift, rings: home.size, states: states.length, of, unmeasured, invalid, badHold, zeroed, distinct },
  };
}

function lampVariants(rows) {
  const ratios = rows.filter((r) => r.k === "lampLegibility");
  const invalid = ratios.filter((r) => !(Number.isFinite(r.ratio) && r.ratio > 0)).length;
  const bySide = LAMP_SIDES.map((side) => ratios.filter((r) => r.side === side).map((r) => r.ratio));
  const worst = bySide.map((own) => (own.length ? Math.min(...own) : NaN));
  const measured = invalid === 0 && worst.every(Number.isFinite);
  const even = measured ? evenness(worst) : NaN;
  const samples = Math.min(...bySide.map((own) => own.length));
  return {
    pass: measured && samples >= LAMP_SWAY.samples && even >= LAMP_SYMMETRY && Math.min(...worst) >= LAMP_FLOOR,
    metrics: Object.fromEntries([...LAMP_SIDES.map((side, i) => [side, worst[i]]), ["evenness", even], ["samples", samples], ["invalid", invalid]]),
  };
}

// The window a throw is judged over: its landing, the bomb's aftermath and the lamp's swing to the next seat (scenarios/threadLoad.ts).
const THROW_WINDOW_MS = 1200;

function throwStalls(rows) {
  const throws = times(rows, "throw");
  const spans = rows.filter((r) => r.k === "frame" || r.k === "jsLag");
  const windows = throws.map((t) => spans.filter((r) => r.t >= t && r.t - r.dt <= t + THROW_WINDOW_MS));
  const stalls = windows.reduce((n, w) => n + burstStalls(w).stalls, 0);
  const covered = (w, t) =>
    w.filter((r) => r.k === "frame").reduce((ms, r) => ms + Math.max(0, Math.min(r.t, t + THROW_WINDOW_MS) - Math.max(r.t - r.dt, t)), 0);
  const framed = throws.length ? windows.filter((w, i) => covered(w, throws[i]) >= THROW_WINDOW_MS * 0.8).length / throws.length : 0;
  const { jsTicks } = burstStalls(rows);
  return {
    pass: throws.length >= 10 && framed === 1 && jsTicks > 0 && stalls === 0,
    metrics: { throws: throws.length, stalls, framed, jsTicks, medianHz: medianHz(rows), hitchesPerSecond: hitches(rows).perSecond },
  };
}

function halves(rows) {
  const marks = rows.filter((r) => r.k === "half").sort((a, b) => a.t - b.t);
  return marks.map((h, i) => {
    const own = rows.filter((r) => r.t >= h.t && r.t < (marks[i + 1]?.t ?? Infinity));
    const p95 = own.filter((r) => r.k === "frame" && r.dt > 0).map((r) => r.dt).sort((a, b) => a - b);
    return { name: h.name, pair: h.pair, hz: medianHz(own), rate: meanHz(own), hitches: hitches(own).perSecond, p95: p95.length ? p95[Math.ceil(p95.length * 0.95) - 1] : NaN, ...burstStalls(own) };
  });
}

// A swaying lamp must hold 115 of a 120 Hz display (0.95 of the ceiling) with its slow tail inside 1.5 frames.
const REST_FLOOR = 0.95;
const REST_TAIL = 1.5;
const LEGACY_CEILING = 120;

function restCost(rows) {
  const all = halves(rows);
  const frozen = all.filter((h) => h.name === "frozen");
  const swaying = all.filter((h) => h.name === "swaying");
  const ceiling = systemSummary(rows)?.maxFps || LEGACY_CEILING;
  const brief = (hs) => hs.map(({ hz, stalls }) => ({ hz, stalls }));
  const held = (h) => h.frames > 0 && h.rate >= ceiling * REST_FLOOR && h.p95 <= (REST_TAIL * 1000) / ceiling && h.stalls === 0;
  return {
    pass: frozen.length === 4 && swaying.length === 4 && frozen.every((h) => h.frames > 0) && swaying.every(held),
    metrics: {
      medianHz: medianHz(rows), ceiling, frozen: brief(frozen), swaying: brief(swaying),
      rate: { frozen: frozen.map((h) => h.rate), swaying: swaying.map((h) => h.rate) },
      p95: { frozen: frozen.map((h) => h.p95), swaying: swaying.map((h) => h.p95) },
      hitchesPerSecond: { frozen: frozen.map((h) => h.hitches), swaying: swaying.map((h) => h.hitches) },
    },
  };
}

// Two halves count as a pair only if the display held about one rate through both (a governor step between them is not the felt's doing), and a win needs a margin past rounding.
const PAIR_RATE_TOLERANCE = 0.15;
const WIN_MARGIN_MS = 0.5;

function feltOpaque(rows) {
  const all = halves(rows);
  const pairs = [0, 1, 2, 3].map((p) => ["on", "off"].map((name) => all.find((h) => h.name === name && h.pair === p && h.frames > 0)));
  const whole = pairs.filter(([on, off]) => on && off && Math.abs(on.rate - off.rate) <= PAIR_RATE_TOLERANCE * Math.max(on.rate, off.rate));
  const recorded = whole.length;
  const wins = whole.filter(([on, off]) => on.p95 + WIN_MARGIN_MS <= off.p95).length;
  const noWorse = whole.every(([on, off]) => on.stalls <= off.stalls);
  const outcome = recorded === 4 ? (noWorse && wins >= 3 ? "keep" : "drop") : null;
  const brief = (i) => pairs.map((pair) => (pair[i] ? { hz: pair[i].hz, p95: pair[i].p95, stalls: pair[i].stalls } : null));
  return { pass: outcome !== null, metrics: { outcome, wins, recorded, medianHz: medianHz(rows), on: brief(0), off: brief(1) } };
}

// D2: a pill or panel enters in 160 ms. Q1: a mark (chip) or float in 100, the net dot blinks every 900.
const NOTICE_ENTER_MS = { pill: 160, panel: 160, chip: 100, float: 100 };
const NET_BLINK_MS = 900;
// A blink period is several legs, and each leg ends on its own first frame past its length.
const BLINK_LEGS = NET_BLINK_MS / noticeBlink(false).half;
const GALLERY_ROUNDS = 5;
// An entrance ends on the first frame at or past its length, so it may overrun by that frame's own interval.
const ENTER_SLACK_MS = 1;
// The calm dot is sampled every 100 ms of its 2 s showing (TableNotice's DOT_SAMPLE_MS): half of those is a floor.
const DOT_SAMPLES_MIN = 10;

function noticeGallery(rows) {
  const plan = rows.find((r) => r.k === "gallery");
  const shows = rows.filter((r) => r.k === "shown").sort((a, b) => a.t - b.t);
  const calmFrom = shows.find((s) => s.reduced)?.t ?? Infinity;
  const notices = rows.filter((r) => r.k === "notice");
  const unseen = shows.filter((s, i) =>
    !notices.some((n) => n.src === "gallery" && n.kind === s.kind && (n.phase === "enter" || n.phase === "still") && n.t >= s.t && n.t < (shows[i + 1]?.t ?? Infinity))
  ).length;
  const frameMs = Math.min(1000 / meanHz(rows), 1000 / 60);
  const enter = Object.fromEntries(
    Object.entries(NOTICE_ENTER_MS).map(([shape, ms]) => {
      const entrances = notices.filter((n) => n.src === "gallery" && n.phase === "enter" && n.shape === shape);
      const off = entrances.map((n) => (n.ms < ms ? ms - n.ms : Math.max(0, n.ms - ms - (n.dt ?? 0))));
      return [shape, { p90: p90(entrances.map((n) => n.ms)), off: p90(off) }];
    })
  );
  const periods = rows.filter((r) => r.k === "blink" && r.t < calmFrom).map((r) => r.period);
  const calmBlinks = rows.filter((r) => r.k === "blink" && r.t >= calmFrom).length;
  const calmDots = rows.filter((r) => r.k === "dot" && r.t >= calmFrom).map((r) => r.opacity);
  const dotRuns = shows
    .map((s, i) => rows.filter((r) => r.k === "dot" && r.t >= s.t && r.t < (shows[i + 1]?.t ?? Infinity)).length)
    .filter((n, i) => shows[i].reduced && n > 0);
  const periodOff = Math.abs(median(periods) - NET_BLINK_MS);
  const b = burstStalls(rows);
  const moving = shows.filter((s) => !s.reduced).length;
  const calm = shows.length - moving;
  const pass =
    plan !== undefined && plan.fixtures > 0 && moving === GALLERY_ROUNDS * plan.fixtures && calm === plan.fixtures &&
    new Set(shows.map((s) => s.kind)).size === plan.kinds && unseen === 0 &&
    Object.values(enter).every((e) => e.off <= ENTER_SLACK_MS) &&
    periods.length >= GALLERY_ROUNDS && periodOff <= BLINK_LEGS * frameMs && calmBlinks === 0 && calmDots.length > 0 && calmDots.every((o) => o === 1) && dotRuns.every((n) => n >= DOT_SAMPLES_MIN) &&
    b.frames > 0 && b.jsTicks > 0 && b.stalls === 0;
  return {
    pass,
    metrics: { shows: shows.length, moving, calm, unseen, frameMs, enter, periods: periods.length, periodMs: median(periods), calmBlinks, calmDots: calmDots.length, stalls: b.stalls, frames: b.frames, jsTicks: b.jsTicks },
  };
}

// `sys` rows come once a second from the phone; cpuMs is cumulative, so a rate needs two of them.
function systemSummary(rows) {
  const sys = rows.filter((r) => r.k === "sys").sort((a, b) => a.t - b.t);
  if (sys.length === 0) return null;
  const cpu = sys.slice(1).flatMap((r, i) => {
    const dt = r.t - sys[i].t;
    return dt > 0 && r.cpuMs >= 0 && sys[i].cpuMs >= 0 ? [((r.cpuMs - sys[i].cpuMs) / dt) * 100] : [];
  });
  const battery = sys.filter((r) => r.battery >= 0).map((r) => r.battery);
  return {
    samples: sys.length,
    maxFps: Math.max(...sys.map((r) => r.maxFps)),
    maxThermal: Math.max(...sys.map((r) => r.thermal)),
    thermalAtEnd: sys.at(-1).thermal,
    lowPower: sys.some((r) => r.lowPower),
    charging: sys.some((r) => r.charging),
    batteryDropPct: battery.length ? +((battery[0] - battery.at(-1)) * 100).toFixed(1) : null,
    cpuPctP50: median(cpu),
    cpuPctP90: p90(cpu),
    gpuMbMax: Math.max(...sys.map((r) => r.gpuMb)),
  };
}

// The refusal floor is the display's own ceiling, so a 60 Hz phone is judged against 60.
const SUSTAINED_FLOOR = 0.85;
const SUSTAINED_SAG = 0.1;
// ProcessInfo.ThermalState: 2 is serious, where iOS starts to cap the frame rate for heat.
const THERMAL_SERIOUS = 2;

function windowsOf(rows) {
  const marks = rows.filter((r) => r.k === "window").sort((a, b) => a.t - b.t);
  return marks.map((w, i) => {
    const own = rows.filter((r) => r.t >= w.t && r.t < (marks[i + 1]?.t ?? Infinity));
    const frames = own.filter((r) => r.k === "frame" && r.dt > 0).map((r) => r.dt).sort((a, b) => a - b);
    return { i: w.i, hz: meanHz(own), hitches: hitches(own).perSecond, p95: frames.length ? frames[Math.ceil(frames.length * 0.95) - 1] : NaN, ...burstStalls(own), sys: systemSummary(own) };
  });
}

// The deal is ten fresh mounts: each must show frames, no stall, and the rate the display can give; its slow tail and hitches are reported for the first device run to set a bound on.
const DEALS = 10;

function dealBurst(rows) {
  const all = windowsOf(rows);
  const sys = systemSummary(rows);
  const floor = sys ? sys.maxFps * SUSTAINED_FLOOR : NaN;
  const capped = sys?.lowPower ?? true;
  return {
    pass: all.length === DEALS && sys !== null && all.every((w) => w.frames > 0 && w.jsTicks > 0 && w.stalls === 0 && w.hz >= floor) && !capped,
    metrics: {
      deals: all.length, floor, capped, hz: meanHz(rows),
      worstP95: Math.max(...all.map((w) => w.p95)), hitchesPerSecond: hitches(rows).perSecond,
      perDeal: all.map(({ i, hz, p95, stalls, hitches }) => ({ i, hz, p95, stalls, hitches })),
    },
  };
}

function sustained(rows) {
  const all = windowsOf(rows);
  const sys = systemSummary(rows);
  const hz = all.map((w) => w.hz);
  const sag = all.length && hz[0] > 0 ? (hz[0] - Math.min(...hz)) / hz[0] : NaN;
  const floor = sys ? sys.maxFps * SUSTAINED_FLOOR : NaN;
  const capped = sys?.lowPower ?? true;
  const brief = all.map(({ i, hz, p95, stalls, hitches, sys }) => ({ i, hz, p95, stalls, hitches, thermal: sys?.maxThermal ?? null, cpuPctP50: sys?.cpuPctP50 ?? null }));
  return {
    pass:
      all.length >= 2 && sys !== null && all.every((w) => w.frames > 0 && w.jsTicks > 0 && w.stalls === 0 && w.hz >= floor) &&
      sag <= SUSTAINED_SAG && sys.maxThermal < THERMAL_SERIOUS && !capped,
    metrics: { windows: all.length, sag, floor, capped, hz: meanHz(rows), perWindow: brief },
  };
}

export const GATES = {
  pulseCost, idle, tapBurst, scheduledOnset, hapticOnset, musicSwitch, smoke, soak, landingSync, seatAnchors, lampVariants,
  throwStalls, restCost, feltOpaque, noticeGallery, sustained, dealBurst,
};

// The phone numbers each POST (`seq`) in the order it sent them; the PC file holds them in the order they arrived. A session's rows are put back in send order, rows of one batch keeping their own.
function inSendOrder(rows) {
  if (!rows.some((r) => Number.isFinite(r.seq))) return rows;
  // A POST whose answer was lost is sent again and lands twice: the second copy of a batch is dropped.
  const seen = new Set();
  let copy = false;
  const once = rows.filter((r) => {
    if (r.k === "batch") copy = seen.has(r.seq) || (seen.add(r.seq), false);
    return !copy;
  });
  return once.map((r, i) => [r, i]).sort(([a, i], [b, j]) => (a.session === b.session ? (a.seq ?? 0) - (b.seq ?? 0) : 0) || i - j).map(([r]) => r);
}

function bracket(all, scenario) {
  const start0 = all.findLastIndex((r) => r.k === "scenario" && r.name === scenario && r.phase === "start");
  if (start0 === -1) return null;
  const session = all[start0].session;
  const rows = inSendOrder(all.filter((r) => r.session === session));
  const start = rows.findLastIndex((r) => r.k === "scenario" && r.name === scenario && r.phase === "start");
  const end = rows.findIndex((r, i) => i > start && r.k === "scenario" && r.name === scenario && r.phase === "end");
  if (end === -1) return null;
  const first = rows[start].seq;
  const last = rows[end].seq;
  const numbered = Number.isFinite(first) && Number.isFinite(last);
  const batches = rows.filter((r) => r.k === "batch" && (!numbered || (r.seq >= first && r.seq <= last)));
  const seen = new Set(batches.map((r) => r.seq));
  const lost = numbered ? Array.from({ length: last - first + 1 }, (_, i) => first + i).filter((q) => !seen.has(q)) : [];
  const dropped = batches.reduce((n, r) => n + (r.dropped ?? 0), 0);
  return { rows: rows.slice(start, end + 1), session, error: rows[end].error ?? null, lost, dropped };
}

function unrun(build) {
  if (!build) return "no build row";
  if (build.dev) return "dev JS";
  return !build.scriptURL || /^https?:/i.test(build.scriptURL) ? "not an embedded Release bundle" : null;
}

/** @param {Record<string, (rows: any[]) => { pass: boolean | null; metrics: Record<string, any> }>} [gates] */
export function verdict(rows, scenario, gates = GATES) {
  const gate = gates[scenario];
  const part = gate && bracket(rows, scenario);
  if (!part) return null;
  const v = gate(part.rows);
  const sys = systemSummary(part.rows);
  const seen = sys ? { ...v, metrics: { ...v.metrics, sys } } : v;
  const judged = part.error
    ? { pass: false, metrics: { ...seen.metrics, error: part.error } }
    : part.dropped > 0 ? { pass: false, metrics: { ...seen.metrics, dropped: part.dropped } }
    : part.rows.some((r) => r.k === "nativeDropped" || r.k === "captureStopped")
      ? { pass: false, metrics: { ...seen.metrics, nativeDropped: part.rows.filter((r) => r.k === "nativeDropped").reduce((n, r) => n + r.n, 0), captureStopped: part.rows.filter((r) => r.k === "captureStopped").map((r) => r.error) } }
    : part.lost.length > 0 ? { pass: false, metrics: { ...seen.metrics, lostBatches: part.lost } } : seen;
  const reason = unrun(rows.findLast((r) => r.k === "build" && r.session === part.session));
  return reason ? { pass: null, metrics: { ...judged.metrics, unrun: reason } } : judged;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  if (process.argv[2] === "--flinger") {
    const v = flingerVerdict(readFileSync(process.argv[3], "utf8"), readFileSync(process.argv[4], "utf8"));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.pass ? 0 : 1);
  }
  const [file, scenario] = process.argv.slice(2);
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const names = scenario === "all" ? Object.keys(GATES).filter((n) => rows.some((r) => r.k === "scenario" && r.name === n)) : [scenario];
  const out = Object.fromEntries(names.map((n) => [n, verdict(rows, n)]));
  console.log(JSON.stringify(out, null, 2));
  process.exit(names.length > 0 && names.every((n) => out[n]?.pass === true) ? 0 : 1);
}
