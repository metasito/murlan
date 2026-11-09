// The web half of the render spike (rest-architecture PR 0). Records; it does not gate.
// SPIKE_OUT names the JSON it writes. Run: SPIKE_URL=... npx playwright test --config tests/e2e/playwright.spike.config.ts
import { test, expect, chromium, type Page } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { LOOP_SECONDS, STOPS, SWAY_AMPLITUDE, opacityFrom } from "../../components/table/spike/swayTable";

const OUT = process.env.SPIKE_OUT ?? "spike-web.json";
const result: Record<string, unknown> = {};
test.afterAll(() => writeFileSync(OUT, JSON.stringify(result, null, 2)));

const MODEL = `const STOPS=${JSON.stringify(STOPS)},LOOP=${LOOP_SECONDS},A=${SWAY_AMPLITUDE};const opAt=t=>(${opacityFrom.toString()})(STOPS,t);`;

async function open(page: Page, dpr = 1) {
  await page.goto("/spike");
  await page.waitForFunction(() => (window as unknown as { spike?: unknown }).spike && document.getElementById("bc"), undefined, { timeout: 120_000 });
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
}

test("Q1 keyframes with an easing per keyframe, against the model across the whole loop", async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async (model) => {
    // eslint-disable-next-line no-new-func
    const m = new Function(`${model}; return {opAt, LOOP, A};`)();
    const s = (window as any).spike;
    await s.setDriver("css", 0);
    const b = document.getElementById("b")!;
    const anims = b.getAnimations();
    const rule = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } }).filter((r) => r.constructor.name === "CSSKeyframesRule" && (r as CSSKeyframesRule).name.startsWith("REA-CSS")).pop() as CSSKeyframesRule | undefined;
    const withEasing = rule ? [...rule.cssRules].filter((r) => (r as CSSKeyframeRule).style.animationTimingFunction.startsWith("cubic-bezier")).length : 0;
    const a = anims[0];
    a.pause();
    let max = 0, sum = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const t = ((i * 0.6180339887) % 1) * m.LOOP;
      a.currentTime = t * 1000;
      const o = Number(getComputedStyle(b).opacity);
      const e = Math.abs(m.A * (2 * o - 1) - m.A * (2 * m.opAt(t) - 1));
      max = Math.max(max, e);
      sum += e;
    }
    return { animations: anims.length, type: anims[0]?.constructor.name, keyframeRules: rule?.cssRules.length ?? 0, withEasing, samples: N, maxErrPt: max, meanErrPt: sum / N };
  }, MODEL);
  result.q1 = out;
  expect(out.animations).toBe(1);
});

test("Q3 handoff both ways, pause and resume", async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async (model) => {
    // eslint-disable-next-line no-new-func
    const m = new Function(`${model}; return {opAt, LOOP, A};`)();
    const s = (window as any).spike;
    const b = document.getElementById("b")!;
    type F = { ts: number; o: number; css: boolean; shift: number };
    const frames: F[] = [];
    let stop = false;
    let shift = 0;
    const rec = (ts: number) => {
      frames.push({ ts, o: Number(getComputedStyle(b).opacity), css: b.getAnimations().length > 0, shift });
      if (!stop) requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const clock = s.clock();
    clock.start = performance.now();
    const tnow = () => (performance.now() - clock.start) / 1000;
    await s.setDriver("live", 0);
    const marks: number[] = [];
    const lat: number[] = [];
    let lead = 0;
    const groups: number[] = [];
    for (let c = 0; c < 20; c++) {
      if (c === 10) lead = lat.sort((x, y) => x - y)[5] / 1000;
      await sleep(400 + ((c * 137) % 700));
      const t0 = performance.now();
      marks.push(frames.length);
      groups.push(c < 10 ? 0 : 1);
      await s.setDriver("css", tnow() + lead);
      lat.push(c < 10 ? (b.getAnimations()[0]?.startTime as number) - t0 : 0);
      await sleep(400 + ((c * 211) % 700));
      marks.push(frames.length);
      groups.push(c < 10 ? 0 : 1);
      await s.setDriver("live", tnow());
    }
    await s.setDriver("css", tnow());
    await sleep(800);
    const handoffEnd = frames.length;
    const pauseAt = performance.now();
    const pauseI = frames.length;
    await s.setDriver("paused");
    await sleep(3000);
    const frozen = frames.slice(pauseI + 4).map((f) => f.o);
    const frozenDev = Math.max(...frozen.map((o) => Math.abs(m.A * 2 * (o - frozen[0]))));
    const gap = performance.now() - pauseAt;
    shift = gap;
    const resumeI = frames.length;
    await s.setDriver("css");
    await sleep(3000);
    stop = true;
    await sleep(100);
    const lx = (o: number) => m.A * (2 * o - 1);
    const modelAt = (i: number) => {
      const f = frames[i];
      const tag = f.css ? f.ts : (frames[i - 1]?.ts ?? f.ts);
      return lx(m.opAt((tag - clock.start - f.shift) / 1000));
    };
    const near = new Set<number>();
    for (const i of marks) for (let d = -8; d <= 8; d++) near.add(i + d);
    const grp = (i: number, dir: number) => { for (let j = 0; j < marks.length; j++) if (j % 2 === dir && Math.abs(i - marks[j]) <= 8) return groups[j]; return -1; };
    const byGroup: Record<string, number> = {};
    for (let i = 2; i < frames.length; i++) {
      for (const dir of [0, 1]) {
        const g = grp(i, dir);
        if (g < 0) continue;
        const key = (dir === 0 ? "live->css " : "css->live ") + (g === 0 ? "naive" : "with lead");
        byGroup[key] = Math.max(byGroup[key] ?? 0, Math.abs(lx(frames[i].o) - modelAt(i)));
      }
    }
    let atHandoff = 0, steadyCss = 0, steadyLive = 0, stepExcess = 0, afterResume = 0, resumeStep = 0;
    for (let i = 2; i < handoffEnd; i++) {
      const e = Math.abs(lx(frames[i].o) - modelAt(i));
      if (near.has(i)) {
        atHandoff = Math.max(atHandoff, e);
        stepExcess = Math.max(stepExcess, Math.abs(lx(frames[i].o) - lx(frames[i - 1].o) - (modelAt(i) - modelAt(i - 1))));
      } else if (frames[i].css) steadyCss = Math.max(steadyCss, e);
      else steadyLive = Math.max(steadyLive, e);
    }
    for (let i = resumeI + 2; i < frames.length; i++) afterResume = Math.max(afterResume, Math.abs(lx(frames[i].o) - modelAt(i)));
    for (let i = resumeI - 1; i < resumeI + 8; i++) resumeStep = Math.max(resumeStep, Math.abs(lx(frames[i].o) - lx(frames[i - 1].o) - (modelAt(i) - modelAt(i - 1))));
    return {
      handoffs: marks.length,
      byGroup,
      leadMs: lead * 1000,
      animStartLatencyMs: lat.slice(0, 10),
      frameMs: (frames.at(-1)!.ts - frames[0].ts) / frames.length,
      maxErrWithin8FramesOfHandoffPt: atHandoff,
      maxStepExcessAtHandoffPt: stepExcess,
      maxErrSteadyCssPt: steadyCss,
      maxErrSteadyLivePt: steadyLive,
      pausedFrozenDevPt: frozenDev,
      pausedMs: gap,
      maxErrAfterResumePt: afterResume,
      maxStepExcessAtResumePt: resumeStep,
    };
  }, MODEL);
  result.q3 = out;
  expect(out.handoffs).toBe(40);
});

async function rssMb(): Promise<number> {
  let kb = 0;
  for (const p of readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    try {
      if (!/chrom/i.test(readFileSync(`/proc/${p}/cmdline`, "utf8"))) continue;
      kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p}/status`, "utf8"))![1]);
    } catch {}
  }
  return kb / 1024;
}

async function measure(dpr: number, setup: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ args: ["--enable-gpu-rasterization"] });
  const ctx = await browser.newContext({ viewport: { width: 874, height: 402 }, deviceScaleFactor: dpr, baseURL: process.env.SPIKE_URL ?? "http://127.0.0.1:8099" });
  const page = await ctx.newPage();
  await open(page, dpr);
  await setup(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(1500);
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  await cdp.send("Tracing.start", { categories: "disabled-by-default-devtools.timeline.frame,devtools.timeline", transferMode: "ReturnAsStream" });
  const a = await metrics();
  await page.waitForTimeout(4000);
  const b = await metrics();
  const events: { name: string }[] = [];
  await new Promise<void>((res) => {
    cdp.on("Tracing.tracingComplete", async ({ stream }) => {
      let data = "";
      for (;;) {
        const r = await cdp.send("IO.read", { handle: stream! });
        data += r.data;
        if (r.eof) break;
      }
      try {
        const j = JSON.parse(data);
        events.push(...(j.traceEvents ?? j));
      } catch {}
      res();
    });
    void cdp.send("Tracing.end");
  });
  const s = b.Timestamp - a.Timestamp;
  const rss = await rssMb();
  await browser.close();
  return {
    mainTaskMsPerS: Math.round(((b.TaskDuration - a.TaskDuration) * 1000) / s),
    scriptMsPerS: Math.round(((b.ScriptDuration - a.ScriptDuration) * 1000) / s),
    drawFramesPerS: Math.round(events.filter((e) => e.name === "DrawFrame").length / s),
    rssMb: Math.round(rss),
  };
}

test("Q4 rest cost and memory; Q5 pool glide; web, DPR 1 and 3, 4x CPU throttle", async () => {
  const modes: Record<string, (p: Page) => Promise<void>> = {
    "one layer, static": async (p) => void (await p.evaluate(() => (window as any).spike.setLayers(1))),
    "two layers, static": async (p) => void (await p.evaluate(() => (window as any).spike.setDriver("static"))),
    "two layers, css sway": async (p) => void (await p.evaluate(() => (window as any).spike.setDriver("css", 0))),
    "two layers, js sway (rAF)": async (p) => {
      await p.evaluate(() => { (window as any).spike.clock().start = performance.now(); return (window as any).spike.setDriver("live", 0); });
    },
    "one layer + plus-lighter pool, css glide": async (p) => void (await p.evaluate(async () => { await (window as any).spike.setLayers(1); await (window as any).spike.setPool(true); })),
  };
  const table: Record<string, Record<string, unknown>> = {};
  for (const dpr of [1, 3]) {
    for (const [name, setup] of Object.entries(modes)) {
      const runs = [];
      for (let r = 0; r < 3; r++) {
        for (let w = 0; w < 120; w++) {
          const load = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
          if (load <= 5) break;
          await new Promise((res) => setTimeout(res, 5000));
        }
        runs.push(await measure(dpr, setup));
      }
      const med = (k: keyof (typeof runs)[0]) => runs.map((x) => x[k]).sort((x, y) => x - y)[1];
      (table[`dpr ${dpr}`] ??= {})[name] = { mainTaskMsPerS: med("mainTaskMsPerS"), scriptMsPerS: med("scriptMsPerS"), drawFramesPerS: med("drawFramesPerS"), rssMb: med("rssMb"), runsTask: runs.map((x) => x.mainTaskMsPerS) };
    }
  }
  result.q4q5 = table;
});

test("Q6 mixBlendMode plus-lighter passes through RN web", async ({ page }) => {
  await open(page);
  const px = async (blend: string) => {
    await page.evaluate(async (b) => {
      const s = (window as any).spike;
      await s.setLayers(1);
      await s.setBlend(b);
      await s.setPool(true);
      const pool = document.getElementById("pool")!;
      pool.getAnimations().forEach((a) => a.pause());
      pool.getAnimations().forEach((a) => (a.currentTime = 0));
    }, blend);
    const cs = await page.evaluate(() => getComputedStyle(document.getElementById("pool")!).mixBlendMode);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 874, height: 402 } });
    const { PNG } = await import("pngjs");
    const png = PNG.sync.read(shot);
    // pool at translate(-300,-150), 760 square, circle radius 380 centred (80, 230)
    const i = (230 * png.width + 80) * 4;
    return { css: cs, rgb: [png.data[i], png.data[i + 1], png.data[i + 2]] };
  };
  result.q6 = { plusLighter: await px("plus-lighter"), screen: await px("screen"), normal: await px("normal"), expected: "base 100 + overlay 128 at alpha .5: plus-lighter 164, screen about 139, normal 114" };
});
