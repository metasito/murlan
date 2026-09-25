// tests/e2e/mockupParity.spec.ts — the fidelity harness (#1255): the real table beside the
// Lantern Table mockup on one virtual clock. Each effect ticket under #1252 registers its moment
// in MOMENTS; `node scripts/mockupParityPage.mjs` builds the side-by-side page from the output.
import { test, expect, type Browser, type Page, type Request } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GIOCA_VALID_LABEL } from "./helpers/labels";
import { offlineGameSave } from "./helpers/offlineSeed";
import { skiaOnSoftware } from "./helpers/tableTrace";
import { installVirtualClock, takeOver, step, stepUntil } from "./helpers/virtualClock";
import {
  diffPillAtProgress,
  diffTraces,
  movingFields,
  STEP_MS,
  type Failure,
  type Field,
  type PillBox,
  type Trace,
  type TraceFrame,
} from "./helpers/traceDiff";
import { regionBrightness, regionsFor, TABLE, type Seat } from "./helpers/parityRegions";
import { E2E_SUSPEND_AI_KEY, OFFLINE_SAVE_KEY, TUTORIAL_SEEN_KEY } from "../../lib/storageKeys";
import { handOffDelayMs } from "../../components/flightPhysics";

const FIXTURE = pathToFileURL(path.resolve(__dirname, "fixtures", "lantern-table", "index.html")).href;
const DPR = 2;
const SEED = 1255;
const STRIP_STEPS = 2;
const CANVASKIT_ROUTE = "**/canvaskit-wasm@*/**";
/** Skia's first frame after the table's, in virtual time: two nested Suspense reveals, each throttled by React. */
const MAX_PRE_ROLL_MS = 60 * STEP_MS;

type SideName = "mockup" | "app";
/** `fallback` holds the CanvasKit request, so the web fallback felt is what is measured. */
type Variant = "skia" | "fallback";

interface Moment {
  /** The mockup's chapter key, `window.T.go`'s. */
  key: string;
  windowMs: number;
  /** Frames before it are stepped, not compared: the app's resume deals the hand in through the pool. */
  fromMs?: number;
  /** In the chapter's time, which both sides label their frames with. */
  checkpoints: number[];
  seatOnMove: Seat;
  /** Brings the app to the instant before its onset; the onset is the first traced frame `appOnset` accepts. */
  appTrigger: (page: Page, baseURL: string) => Promise<void>;
  appOnset: (frame: TraceFrame) => boolean;
  mode: "determinism" | "parity";
  /** Determinism mode: exactly the fields each side must move over the window; every other must hold still. */
  moves?: Record<SideName, Field[]>;
  /** Parity mode: the fields held to the mockup, and the regions whose brightness is. */
  fields?: Field[];
  regions?: string[];
  /** The mockup's chapter, where it is not `key`. */
  chapter?: string;
  mockupScript?: string;
  /** Done on each side at `atMs` in chapter time: the app's by Playwright, the mockup's as a script. A side
   *  without one leaves it to the mockup's own chapter script. */
  actions?: { atMs: number; app?: (page: Page) => Promise<unknown>; mockup?: string }[];
  /** Gates the app's pill box against the mockup's `renderScore` at each progress the app traced. */
  pillAtProgress?: boolean;
  variants?: Variant[];
}

/** The mockup's `BASE`, by the seat each name sits at: luan right, besnik across, gent left. */
const MOCKUP_SCORES = { player_0: 15, player_1: 11, player_2: 16, player_3: 10 };

const heldTurnTable = async (page: Page, baseURL: string) => {
  await skiaOnSoftware(page);
  await page.addInitScript(
    (entries) => {
      for (const [k, v] of entries) window.localStorage.setItem(k, v);
    },
    [
      [TUTORIAL_SEEN_KEY, "1"],
      [E2E_SUSPEND_AI_KEY, "1"],
      [OFFLINE_SAVE_KEY, JSON.stringify(offlineGameSave(4, 13, 0, MOCKUP_SCORES))],
    ]
  );
  await page.goto(baseURL);
  await takeOver(page);
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await stepUntil(page, () => resume.isVisible(), "the home screen");
  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  await resume.click({ force: true });
};

const pass = (page: Page) => page.evaluate(() => (globalThis as unknown as { murlanPass: () => void }).murlanPass());

const playLowest = async (page: Page) => {
  await page.locator('[data-hand-state] [data-testid="card-box"]').first().click({ force: true });
  await page.getByRole("button", { name: GIOCA_VALID_LABEL }).click({ force: true });
};

const MOMENTS: Moment[] = [
  {
    key: "rest",
    windowMs: 2400,
    fromMs: MAX_PRE_ROLL_MS,
    checkpoints: [MAX_PRE_ROLL_MS, 1440, 1920, 2400],
    seatOnMove: "you",
    appTrigger: heldTurnTable,
    appOnset: (f) => f.lamp !== null,
    mode: "parity",
    fields: ["lamp", "level", "flare", "brightness", "scorePill"],
    regions: ["pool", "rim", "rightBand", "scorePill"],
  },
  {
    key: "trick",
    windowMs: 6800,
    // Each 750 ms after a hand-off, where the lamp's glide covers under 2 pt a frame.
    checkpoints: [1040, 2496, 4000, 5296, 6704],
    // The mockup hands off anticlockwise; GAME-RULES.md plays clockwise, so its lamp takes the left seat next.
    mockupScript: "Object.assign(POOL, { luan: POOL.gent, gent: POOL.luan });",
    seatOnMove: "you",
    appTrigger: heldTurnTable,
    appOnset: (f) => f.lamp !== null,
    mode: "parity",
    fields: ["lamp", "level"],
    regions: [],
    actions: [
      { atMs: 1750 - handOffDelayMs(false), app: playLowest },
      { atMs: 3250, app: pass },
      { atMs: 4550, app: pass },
      { atMs: 5950, app: pass },
    ],
  },
  {
    key: "score-open",
    chapter: "rest",
    windowMs: 960,
    checkpoints: [0, 480, 960],
    seatOnMove: "you",
    appTrigger: heldTurnTable,
    appOnset: (f) => f.lamp !== null,
    mode: "determinism",
    moves: {
      mockup: ["onset", "lamp", "brightness", "scorePill"],
      app: ["onset", "lamp", "level", "brightness", "scorePill"],
    },
    actions: [
      { atMs: 320, app: (page) => page.getByTestId("score-pill").click({ force: true }), mockup: "toggleScore(true)" },
    ],
    pillAtProgress: true,
    // The pill, not the felt: Skia's real-time load would take the window and the byte-for-byte replay.
    variants: ["fallback"],
  },
];

interface Capture {
  trace: Trace;
  frames: { t: number; jpeg: Buffer }[];
}

const PILL_BOX = `(() => {
  const s = scoreEl.style;
  return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
})()`;

const MOCKUP_SAMPLE = `(() => {
  const m = getComputedStyle(document.getElementById("world")).transform;
  let shake = { x: 0, y: 0, rotate: 0 };
  if (m && m !== "none") {
    const [a, b, , , e, f] = m.slice(m.indexOf("(") + 1, -1).split(",").map(Number);
    shake = { x: e, y: f, rotate: (Math.atan2(b, a) * 180) / Math.PI };
  }
  return {
    onsets: window.__parityOnsets.splice(0),
    live: P.length + lamp.m.length,
    dropped: 0,
    lamp: { x: lamp.lx, y: lamp.ly, level: lamp.L, flare: lamp.f },
    shake,
    scorePill: { ...(${PILL_BOX}), open: SC.o },
  };
})()`;

async function mockupPillAt(browser: Browser, opens: number[]): Promise<Map<number, PillBox>> {
  const page = await newSidePage(browser);
  await page.goto(FIXTURE);
  await page.evaluate("paused = true");
  const boxes = new Map<number, PillBox>();
  for (const o of new Set(opens)) {
    boxes.set(o, await page.evaluate(`(() => { SC.o = ${o}; SC.b = 0; renderScore(); return ${PILL_BOX}; })()`));
  }
  await page.context().close();
  return boxes;
}

async function newSidePage(browser: Browser, baseURL?: string): Promise<Page> {
  const context = await browser.newContext({ viewport: TABLE, deviceScaleFactor: DPR, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  return page;
}

async function strip(
  page: Page,
  clip: { x: number; y: number },
  decoder: Page,
  m: Moment,
  startMs: number,
  act: (action: NonNullable<Moment["actions"]>[number]) => Promise<unknown> | undefined,
  stepTo: (t: number) => Promise<TraceFrame | null>
): Promise<Capture> {
  const frames: Capture["frames"] = [];
  const traced: TraceFrame[] = [];
  const regions: Trace["regions"] = [];
  const all = regionsFor(m.seatOnMove);
  const shape = m.regions ? Object.fromEntries(m.regions.map((r) => [r, all[r]])) : all;
  const due = [...(m.actions ?? [])];
  for (let k = 0; startMs + k * STEP_MS <= m.windowMs; k++) {
    const t = startMs + k * STEP_MS;
    while (due.length && due[0].atMs <= t) await act(due.shift()!);
    const frame = await stepTo(t);
    if (t < (m.fromMs ?? 0)) continue;
    if (frame) traced.push({ ...frame, t });
    if (k % STRIP_STEPS === 0) {
      const jpeg = await page.screenshot({ type: "jpeg", quality: 80, clip: { ...clip, ...TABLE } });
      frames.push({ t, jpeg });
      regions.push({ t, regions: await regionBrightness(decoder, jpeg, DPR, shape) });
    }
  }
  return { trace: { frames: traced, regions }, frames };
}

async function captureMockup(browser: Browser, decoder: Page, m: Moment, preRollMs: number): Promise<Capture> {
  const page = await newSidePage(browser);
  await page.goto(FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate("paused = true");
  const frameBox = async () => (await page.locator("#frame").boundingBox())!;
  const off = TABLE.width - (await frameBox()).width;
  if (off !== 0) await page.setViewportSize({ width: TABLE.width + off, height: TABLE.height });
  await page.setViewportSize({ width: TABLE.width + off, height: Math.ceil((await frameBox()).y + TABLE.height) });
  await takeOver(page);
  const box = await frameBox();
  expect(box.width).toBe(TABLE.width);
  // The onset frame steps the scene by 0: rAF fires on the clock's 16 ms grid, and the real time
  // that leaks in before `pauseAt` puts the page's own `last` off that grid by a varying amount.
  await page.evaluate(`(() => {
    window.__parityOnsets = [];
    const sound = sfx;
    window.sfx = (k) => { window.__parityOnsets.push("sound:" + k); sound(k); };
    paused = true;
    ${m.mockupScript ?? ""}
    requestAnimationFrame(() => { paused = false; });
    start(CH.findIndex((c) => c.key === ${JSON.stringify(m.chapter ?? m.key)}));
  })()`);
  for (let rolled = 0; rolled < preRollMs; rolled += STEP_MS) await step(page);
  const capture = await strip(page, box, decoder, m, preRollMs, (a) => (a.mockup ? page.evaluate(a.mockup) : undefined), async () => {
    await step(page);
    return { t: 0, ...((await page.evaluate(MOCKUP_SAMPLE)) as Omit<TraceFrame, "t">) };
  });
  await page.context().close();
  return capture;
}

const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames);

async function traced(page: Page, accept: (f: TraceFrame) => boolean, what: string): Promise<number> {
  let t = -1;
  await stepUntil(page, async () => (t = (await recorded(page)).find(accept)?.t ?? -1) >= 0, what, { chunkMs: STEP_MS });
  return t;
}

/** Whether a chunk or CanvasKit is still loading, in real time, on `page` since it opened. */
function trackLoads(page: Page): () => Promise<string[]> {
  const inFlight = new Set<Request>();
  let wasmRequested = false;
  page.on("request", (r) => {
    inFlight.add(r);
    wasmRequested ||= r.url().includes("canvaskit-wasm@");
  });
  page.on("requestfinished", (r) => inFlight.delete(r));
  page.on("requestfailed", (r) => inFlight.delete(r));
  return async () => {
    const loading = [...inFlight].map((r) => r.url());
    if (wasmRequested && !(await page.evaluate(() => "CanvasKit" in globalThis))) loading.push("CanvasKit compiling");
    return loading;
  };
}

/** Skia's felt. The virtual clock stands still while anything loads, so the pre-roll counts the table's own frames. */
async function skiaOnset(page: Page, mounted: number, loading: () => Promise<string[]>): Promise<number> {
  const deadline = Date.now() + 90_000;
  const isSkia = (f: TraceFrame) => f.t > mounted && f.felt === "skia";
  while (!(await recorded(page)).some(isSkia)) {
    const waiting = await loading();
    if (Date.now() > deadline) throw new Error(`Skia never drew; still loading: ${waiting.join(", ") || "nothing"}`);
    if (waiting.length === 0) await step(page);
    await new Promise((r) => setTimeout(r, 20));
  }
  const onset = (await recorded(page)).find(isSkia)!.t;
  expect(onset - mounted, "Skia's first frame, after the table's").toBeLessThanOrEqual(MAX_PRE_ROLL_MS);
  return onset;
}

async function captureApp(browser: Browser, baseURL: string, decoder: Page, m: Moment, variant: Variant) {
  const page = await newSidePage(browser, baseURL);
  const loading = trackLoads(page);
  if (variant === "fallback") await page.route(CANVASKIT_ROUTE, () => undefined);
  await m.appTrigger(page, baseURL);
  const mounted = await traced(page, m.appOnset, `the app's onset of ${m.key}`);
  const onset = variant === "skia" ? await skiaOnset(page, mounted, loading) : mounted;
  const preRollMs = Math.ceil((onset - mounted) / STEP_MS) * STEP_MS;
  const capture = await strip(page, { x: 0, y: 0 }, decoder, m, preRollMs, (a) => a.app?.(page), async (t) => {
    if (t > preRollMs) await step(page);
    return (await recorded(page)).find((f) => Math.abs(f.t - (onset + t - preRollMs)) < STEP_MS / 2) ?? null;
  });
  const felts = new Set(capture.trace.frames.map((f) => f.felt));
  expect([...felts], `the felt on screen through ${m.key}`).toEqual([variant]);
  await page.context().close();
  return { capture, preRollMs };
}

function bundle(m: Moment, variant: Variant, runs: Record<SideName, Capture>, pillFailures: Failure[], dir: string) {
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const sides = {} as Record<SideName, { trace: Trace; frames: { t: number; file: string; sha1: string }[] }>;
  for (const side of ["mockup", "app"] as const) {
    sides[side] = {
      trace: runs[side].trace,
      frames: runs[side].frames.map(({ t, jpeg }) => {
        const file = `frames/${side}-${String(t).padStart(5, "0")}.jpg`;
        fs.writeFileSync(path.join(dir, file), jpeg);
        return { t, file, sha1: createHash("sha1").update(jpeg).digest("hex") };
      }),
    };
  }
  const held = new Set<Field>(["frames", ...(m.fields ?? [])]);
  const traced = diffTraces(runs.mockup.trace, runs.app.trace, m.checkpoints).filter((f) => m.mode === "determinism" || held.has(f.field));
  const failures = [...traced, ...pillFailures];
  const moment = `${m.key}-${variant}`;
  const parity = { murlanParity: 1, moment, mode: m.mode, stepMs: STEP_MS, checkpoints: m.checkpoints, sides, failures };
  fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(parity));
  return parity;
}

test.describe("mockup parity", () => {
  for (const m of MOMENTS) {
    for (const variant of m.variants ?? (["skia", "fallback"] as const)) {
      test(`${m.key} with the ${variant} felt (${m.mode} mode)`, async ({ browser, baseURL }) => {
        test.setTimeout(15 * 60_000);
        const decoder = await browser.newPage();
        const app = await captureApp(browser, baseURL!, decoder, m, variant);
        const capture = async (side: SideName) =>
          side === "mockup"
            ? captureMockup(browser, decoder, m, app.preRollMs)
            : (await captureApp(browser, baseURL!, decoder, m, variant)).capture;
        const first = { mockup: await capture("mockup"), app: app.capture };

        let pillFailures: Failure[] = [];
        if (m.pillAtProgress) {
          const opens = first.app.trace.frames.flatMap((f) => (f.scorePill ? [f.scorePill.open] : []));
          const boxes = await mockupPillAt(browser, opens);
          pillFailures = diffPillAtProgress(first.app.trace, (open) => boxes.get(open)!);
        }
        const dir = test.info().outputPath(`${m.key}-${variant}`);
        const parity = bundle(m, variant, first, pillFailures, dir);
        await test.info().attach(`${parity.moment}/parity.json`, { path: path.join(dir, "parity.json"), contentType: "application/json" });
        for (const side of ["mockup", "app"] as const) {
          for (const f of parity.sides[side].frames) {
            await test.info().attach(`${parity.moment}/${f.file}`, { path: path.join(dir, f.file), contentType: "image/jpeg" });
          }
        }

        if (m.mode === "parity") {
          expect(parity.failures, "the app's trace against the mockup's").toEqual([]);
          return;
        }
        expect.soft(pillFailures, "the app's pill against renderScore at the same progress").toEqual([]);
        for (const side of ["mockup", "app"] as const) {
          const again = await capture(side);
          expect.soft(again.trace.frames.length, `${side}: frames traced`).toBeGreaterThan(m.windowMs / STEP_MS);
          expect.soft(again.trace, `${side}: the trace replays`).toEqual(first[side].trace);
          const differing = again.frames.filter((f, i) => !f.jpeg.equals(first[side].frames[i].jpeg)).map((f) => f.t);
          expect.soft(differing, `${side}: frames that did not replay byte for byte`).toEqual([]);
          expect.soft([...movingFields(first[side].trace)].sort(), `${side}: fields that move over the window`).toEqual(
            [...m.moves![side]].sort()
          );
        }
      });
    }
  }

  const lastFelt = async (page: Page) => (await recorded(page)).at(-1)?.felt;

  test("the table plays before Skia is ready, then shows the Skia felt", async ({ browser, baseURL }) => {
    test.setTimeout(5 * 60_000);
    const page = await newSidePage(browser, baseURL);
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(CANVASKIT_ROUTE, async (route) => {
      await held;
      await route.continue();
    });
    await heldTurnTable(page, baseURL!);
    await traced(page, (f) => f.felt === "fallback", "the fallback felt");
    await page.locator('[data-hand-state] [data-testid="card-box"]').first().click({ force: true });
    await stepUntil(page, async () => (await page.locator('[data-hand-state] [aria-pressed="true"]').count()) === 1, "a card selected");
    expect(await lastFelt(page), "the felt when the card was taken").toBe("fallback");
    release();
    await stepUntil(page, async () => (await lastFelt(page)) === "skia", "the Skia felt");
    await page.context().close();
  });

  test("a CanvasKit that cannot load leaves the fallback felt under a live table", async ({ browser, baseURL }) => {
    test.setTimeout(5 * 60_000);
    const page = await newSidePage(browser, baseURL);
    await page.route(CANVASKIT_ROUTE, (route) => route.abort());
    const failed = page.waitForEvent("requestfailed", (r) => r.url().includes("canvaskit-wasm@"));
    await heldTurnTable(page, baseURL!);
    await traced(page, (f) => f.felt === "fallback", "the fallback felt");
    await failed;
    for (let i = 0; i < 30; i++) await step(page);
    expect(await lastFelt(page)).toBe("fallback");
    await expect(page.locator('[data-hand-state] [data-testid="card-box"]').first()).toBeVisible();
    await page.context().close();
  });
});
