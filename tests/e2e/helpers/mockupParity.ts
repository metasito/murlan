// The fidelity harness (#1255): the real table beside the Lantern Table mockup on one virtual clock.
// Each effect ticket under #1252 registers its moment in MOMENTS, and a `mockupParity*.spec.ts` file
// runs it: one file per heavy moment, so the shard split can place them apart.
// `node scripts/mockupParityPage.mjs` builds the side-by-side page from the output.
import { test, expect, type Browser, type CDPSession, type Page, type Request } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GIOCA_VALID_LABEL } from "./labels";
import { DEPART_SCRIPT, expectDeparted } from "./lanternDepartures";
import { offlineGameSave } from "./offlineSeed";
import { seatAnchor, settledLight, skiaOnSoftware } from "./tableTrace";
import { installVirtualClock, takeOver, step, stepThen, stepUntil } from "./virtualClock";
import {
  diffParity,
  diffPillAtProgress,
  movingFields,
  STEP_MS,
  type Failure,
  type Field,
  type LayerSample,
  type PillBox,
  type Trace,
  type TraceFrame,
} from "./traceDiff";
import { regionBrightness, regionsFor, TABLE, type Region, type SideLayout } from "./parityRegions";
import { E2E_SUSPEND_AI_KEY, OFFLINE_SAVE_KEY, TUTORIAL_SEEN_KEY } from "../../../lib/storageKeys";

export const FIXTURE = pathToFileURL(path.resolve(__dirname, "..", "fixtures", "lantern-table", "index.html")).href;
const DPR = 2;
const SEED = 1255;
const STRIP_STEPS = 2;
export const CANVASKIT_ROUTE = "**/canvaskit-wasm@*/**";
const CANVASKIT_DIR = path.dirname(require.resolve("canvaskit-wasm/bin/full/canvaskit.js"));
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
  /** Brings the app to the instant before its onset; the onset is the first traced frame `appOnset` accepts. */
  appTrigger: (page: Page, baseURL: string) => Promise<void>;
  appOnset: (frame: TraceFrame) => boolean;
  mode: "determinism" | "parity";
  /** Determinism mode: exactly the fields each side must move over the window; every other must hold still. */
  moves?: Record<SideName, Field[]>;
  /** Parity mode: the fields held to the mockup, and the regions whose brightness is. */
  fields?: Field[];
  regions?: string[];
  /** Parity mode: the only times the regions are sampled, where a moment holds them only there. */
  regionsAt?: number[];
  /** Parity mode: the onsets held, where not every one either side fires. */
  onsets?: string[];
  /** The mockup's chapter, where it is not `key`. */
  chapter?: string;
  mockupScript?: string;
  /** Done on each side at `atMs` in chapter time: the app's by Playwright, the mockup's as a script. A side
   *  without one leaves it to the mockup's own chapter script. */
  actions?: { atMs: number; app?: (page: Page) => Promise<unknown>; mockup?: string }[];
  /** Gates the app's pill box against the mockup's `renderScore` at each progress the app traced. */
  pillAtProgress?: boolean;
  variants?: Variant[];
  /** With the fallback felt, both sides' light rests unswayed: the fallback bakes a still light (plan 3 § Decisions). */
  fallbackStill?: boolean;
  /** Onsets held to a window of the app's time, not to the mockup's onset. */
  onsetWindows?: Record<string, readonly [number, number]>;
  /** The only times the strip keeps a frame, where every other step's would cost more than the page needs. */
  stripAt?: number[];
  /** Two times the app's particle layer must have drawn something, and something different. */
  apart?: readonly [number, number];
  /** Where the mockup's side stops, short of `windowMs`; no checkpoint may lie past it. */
  mockupWindowMs?: number;
}

const STILL_LIGHT = `const swaying = lampStep;
  lampStep = (dt) => { swaying(dt); lamp.lx = lamp.x; };`;

/** The mockup's `BASE`, by the seat each name sits at: luan right, besnik across, gent left. */
const MOCKUP_SCORES = { player_0: 15, player_1: 11, player_2: 16, player_3: 10 };

export const heldTurnTable = (page: Page, baseURL: string) => seatTable(page, baseURL, offlineGameSave(4, 13, 0, MOCKUP_SCORES));

/** The mockup's `trick`: a pair of fives in your hand, nines at the next seat on move (the left) and queens at the last. */
const TRICK_HANDS = [
  ["5_clubs", "5_diamonds", "6_hearts", "6_spades", "7_clubs", "8_diamonds", "10_spades", "J_hearts", "Q_spades", "K_clubs", "A_diamonds", "A_spades", "2_hearts"],
  ["Q_diamonds", "Q_hearts", "3_hearts", "4_clubs", "6_diamonds", "7_hearts", "8_hearts", "9_clubs", "10_hearts", "J_diamonds", "K_spades", "A_clubs", "2_clubs"],
  ["3_clubs", "3_diamonds", "4_diamonds", "4_spades", "5_hearts", "5_spades", "7_spades", "8_spades", "9_diamonds", "10_clubs", "J_spades", "K_hearts", "2_spades"],
  ["9_hearts", "9_spades", "3_spades", "4_hearts", "6_clubs", "7_diamonds", "8_clubs", "10_diamonds", "J_clubs", "Q_clubs", "K_diamonds", "A_hearts", "2_diamonds"],
];
export const pairsTable = (page: Page, baseURL: string) =>
  seatTable(page, baseURL, offlineGameSave(4, 13, 0, MOCKUP_SCORES, TRICK_HANDS));

/** Every opponent below its fan cap (top 7, sides 5), so a fan's centre moves with its count; a bot leads. */
const BELOW_CAPS = [TRICK_HANDS[0], TRICK_HANDS[1].slice(0, 4), TRICK_HANDS[2].slice(0, 5), TRICK_HANDS[3].slice(0, 2)];
export const belowCapsTable = (page: Page, baseURL: string) =>
  seatTable(page, baseURL, offlineGameSave(4, 13, 1, MOCKUP_SCORES, BELOW_CAPS));

const seatTable = async (page: Page, baseURL: string, save: ReturnType<typeof offlineGameSave>) => {
  await skiaOnSoftware(page);
  await page.addInitScript(
    (entries) => {
      for (const [k, v] of entries) window.localStorage.setItem(k, v);
    },
    [
      [TUTORIAL_SEEN_KEY, "1"],
      [E2E_SUSPEND_AI_KEY, "1"],
      [OFFLINE_SAVE_KEY, JSON.stringify(save)],
    ]
  );
  await page.goto(baseURL);
  await takeOver(page);
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await stepUntil(page, () => resume.isVisible(), "the home screen");
  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  await resume.click({ force: true });
};

export const pass = (page: Page) => page.evaluate(() => (globalThis as unknown as { murlanPass: () => void }).murlanPass());

export const botMove = (page: Page) => page.evaluate(() => (globalThis as unknown as { murlanBotMove: () => void }).murlanBotMove());

export const playLowest = (cards: number) => async (page: Page) => {
  const hand = page.locator('[data-hand-state] [data-testid="card-box"]');
  for (let i = 0; i < cards; i++) await hand.nth(i).click({ force: true, position: { x: 8, y: 30 } });
  await page.getByRole("button", { name: GIOCA_VALID_LABEL }).click({ force: true, timeout: 10_000 });
};

const REST_AIR_FROM = MAX_PRE_ROLL_MS;
/** 15 s on, on the step grid. */
const REST_AIR_TO = REST_AIR_FROM + Math.ceil(15_000 / STEP_MS) * STEP_MS;

/** The mockup's three landings in `trick`, as its sampled frames carry them. */
const MOCKUP_LANDINGS = [1584, 3040, 5792];

const MOMENTS: Moment[] = [
  {
    key: "rest",
    windowMs: 2400,
    fromMs: MAX_PRE_ROLL_MS,
    checkpoints: [MAX_PRE_ROLL_MS, 1440, 1920, 2400],
    appTrigger: heldTurnTable,
    appOnset: (f) => f.lamp !== null,
    mode: "parity",
    fields: ["live", "lamp", "level", "flare", "brightness", "scorePill"],
    regions: ["pool", "rim", "rightBand", "scorePill"],
    fallbackStill: true,
  },
  {
    // The motes and the moth over a whole crossing, and #1231's frames 15 s apart.
    key: "rest-air",
    chapter: "rest",
    windowMs: REST_AIR_TO,
    fromMs: REST_AIR_FROM,
    // The mockup's `rest` chapter sends its first moth at 2.5 s, over by 6.5 s; the table's comes 6 to 10 s after it starts.
    mockupWindowMs: 7200,
    checkpoints: [REST_AIR_FROM, 4000, 7200],
    appTrigger: heldTurnTable,
    appOnset: (f) => f.lamp !== null,
    mode: "parity",
    fields: ["onset", "live", "moth", "air"],
    regions: [],
    onsets: ["moment:moth"],
    onsetWindows: { "moment:moth": [6000, 10_000 + STEP_MS] },
    stripAt: [...Array.from({ length: 32 }, (_, i) => REST_AIR_FROM + i * 480), REST_AIR_TO],
    apart: [REST_AIR_FROM, REST_AIR_TO],
  },
  {
    key: "trick",
    windowMs: 6800,
    // Each 750 ms after a hand-off, where the lamp's glide covers under 2 pt a frame.
    checkpoints: [1040, 2496, 4000, 5296, 6704],
    // The mockup hands off anticlockwise; GAME-RULES.md plays clockwise, so its lamp takes the left seat next.
    mockupScript: `Object.assign(POOL, { luan: POOL.gent, gent: POOL.luan });
      const hand = handoff;
      handoff = (a, b) => { window.__parityOnsets.push("moment:handoff"); hand(a, b); };`,
    appTrigger: pairsTable,
    appOnset: (f) => f.lamp !== null,
    mode: "parity",
    fields: ["onset", "lamp", "level"],
    regions: [],
    onsets: ["moment:handoff"],
    actions: [
      { atMs: 1150, app: playLowest(2) },
      { atMs: 3250, app: pass },
      { atMs: 4550, app: pass },
      { atMs: 5950, app: pass },
    ],
  },
  {
    // The same throws as `trick`, held on the flight and the pile rather than the lamp.
    key: "trick-landings",
    chapter: "trick",
    windowMs: 6992,
    checkpoints: [1040, ...MOCKUP_LANDINGS.flatMap((t) => [t + 160, t + 1200])],
    mockupScript: `Object.assign(POOL, { luan: POOL.gent, gent: POOL.luan });
      ember = () => {};`,
    appTrigger: pairsTable,
    appOnset: (f) => f.lamp !== null,
    mode: "parity",
    fields: ["flight", "live", "dropped", "brightness"],
    regions: ["pile"],
    // At rest only: the mockup's nines are down before the first landing's rest.
    regionsAt: [1040, ...MOCKUP_LANDINGS.slice(1).map((t) => t + 1200)],
    actions: [
      { atMs: 1150, app: playLowest(2) },
      { atMs: 2600, app: botMove },
      { atMs: 4150, app: pass },
      { atMs: 5350, app: botMove },
    ],
    // The particle canvas never touches CanvasKit, and a second variant would take the browser suite past MAX_SHARDS.
    variants: ["skia"],
  },
  {
    key: "score-open",
    chapter: "rest",
    windowMs: 960,
    checkpoints: [0, 480, 960],
    appTrigger: heldTurnTable,
    appOnset: (f) => f.lamp !== null,
    mode: "determinism",
    moves: {
      mockup: ["onset", "lamp", "brightness", "scorePill"],
      app: ["onset", "lamp", "brightness", "scorePill"],
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
  layer: LayerSample[];
}

/** The app's particle canvas alone: what it drew, and whether it drew anything. */
const appLayer = async (page: Page): Promise<Omit<LayerSample, "t"> | null> => {
  const drawn = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="particles"]');
    if (!c) return null;
    const px = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    return { url: c.toDataURL(), drawn: px.some((v, i) => i % 4 === 3 && v > 0) };
  });
  return drawn && { sha1: createHash("sha1").update(drawn.url).digest("hex"), drawn: drawn.drawn };
};

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
    lamp: { x: lamp.lx, y: lamp.ly, level: lamp.L, flare: lamp.f, r: lamp.r },
    shake,
    scorePill: { ...(${PILL_BOX}), open: SC.o },
    flight: Math.max(0, ...[...document.querySelectorAll("#pile .grp.cur .card")].map((c) => {
      const t = getComputedStyle(c).transform;
      if (!t || t === "none") return 0;
      const v = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
      return Math.hypot(v[4], v[5]);
    })),
    motes: lamp.m.filter((m) =>
      Math.max(0, 1 - Math.hypot(m.x - lamp.lx, (m.y - lamp.ly) * 1.3) / (300 + lamp.f * 200)) * (.5 + .5 * Math.sin(simT * 1.3 + m.ph)) * lamp.L >= .02
    ).length,
    moth: lamp.mothT >= 0 && lamp.freeze < 1 ? (() => {
      const q = (simT - lamp.mothT) / 4;
      return { x: lamp.lx - 130 + q * 270 + Math.sin(q * 30) * 14, y: lamp.ly - 50 + Math.cos(q * 23) * 18 };
    })() : null,
  };
})()`;

const MOCKUP_LAYOUT = `(() => {
  const frame = document.getElementById("frame").getBoundingClientRect();
  const tops = [...document.querySelectorAll("#hand .card")].map((c) => c.getBoundingClientRect().top - frame.top);
  return { pile: { x: PILE[0], y: PILE[1] }, light: { x: lamp.x, y: lamp.ly }, handTop: Math.min(...tops) };
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

export const sideContext = (browser: Browser, baseURL?: string) =>
  browser.newContext({ viewport: TABLE, deviceScaleFactor: DPR, locale: "it-IT", baseURL });

export async function newSidePage(browser: Browser, baseURL?: string): Promise<Page> {
  const page = await (await sideContext(browser, baseURL)).newPage();
  await installVirtualClock(page, SEED);
  return page;
}

/** Widens the viewport until the mockup's `#frame` is the table's size; returns the frame's box. */
export async function fitFrame(page: Page) {
  const frameBox = async () => (await page.locator("#frame").boundingBox())!;
  const off = TABLE.width - (await frameBox()).width;
  if (off !== 0) await page.setViewportSize({ width: TABLE.width + off, height: TABLE.height });
  await page.setViewportSize({ width: TABLE.width + off, height: Math.ceil((await frameBox()).y + TABLE.height) });
  const box = await frameBox();
  expect(box.width).toBe(TABLE.width);
  return box;
}

/** The same bytes `page.screenshot` yields, in about 60% of its time (#1285). */
async function jpegOf(cdp: CDPSession, clip: { x: number; y: number }): Promise<Buffer> {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 80, clip: { ...clip, ...TABLE, scale: DPR } });
  return Buffer.from(data, "base64");
}

async function strip(
  page: Page,
  clip: { x: number; y: number },
  decoder: Page,
  m: Moment,
  startMs: number,
  act: (action: NonNullable<Moment["actions"]>[number]) => Promise<unknown> | undefined,
  stepTo: (t: number, ms: number, acted: boolean) => Promise<TraceFrame | null>,
  layout: () => Promise<SideLayout>,
  particles: () => Promise<Omit<LayerSample, "t"> | null>
): Promise<Capture> {
  const frames: Capture["frames"] = [];
  const layer: LayerSample[] = [];
  const traced: TraceFrame[] = [];
  const regions: Trace["regions"] = [];
  let shape: Record<string, Region> | undefined;
  const regionsNow = async () => {
    const all = regionsFor(await layout());
    return m.regions ? Object.fromEntries(m.regions.map((r) => [r, all[r]])) : all;
  };
  const cdp = await page.context().newCDPSession(page);
  const due = [...(m.actions ?? [])];
  for (let k = 0; startMs + k * STEP_MS <= m.windowMs; k++) {
    const t = startMs + k * STEP_MS;
    // Each side is at t - STEP_MS here, so an action is taken at its own atMs, not up to a frame before it.
    let ran = 0;
    let acted = false;
    while (due.length && due[0].atMs <= t) {
      const action = due.shift()!;
      const lead = k > 0 ? action.atMs - (t - STEP_MS) - ran : 0;
      if (lead > 0) await step(page, lead);
      ran += Math.max(0, lead);
      await act(action);
      acted = true;
    }
    const frame = await stepTo(t, STEP_MS - ran, acted);
    if (t < (m.fromMs ?? 0)) continue;
    if (frame) traced.push({ ...frame, t });
    if (m.apart?.includes(t)) {
      const sample = await particles();
      if (sample) layer.push({ t, ...sample });
    }
    const stripped = m.stripAt ? m.stripAt.includes(t) : k % STRIP_STEPS === 0;
    const sampled = m.regionsAt ? m.regionsAt.includes(t) : stripped;
    if (!stripped && !sampled) continue;
    const jpeg = await jpegOf(cdp, { x: clip.x, y: clip.y });
    if (stripped) frames.push({ t, jpeg });
    if (!sampled) continue;
    // Once the hand has settled: before `fromMs` it is still being dealt.
    shape ??= await regionsNow();
    regions.push({ t, regions: Object.keys(shape).length ? await regionBrightness(decoder, jpeg, DPR, shape) : {} });
  }
  if (m.regionsAt) {
    expect(regions.map((r) => r.t), "a region sample at every time asked for").toEqual(m.regionsAt.filter((t) => t >= (m.fromMs ?? 0)));
  }
  await cdp.detach();
  return { trace: { frames: traced, regions }, frames, layer };
}

async function captureMockup(browser: Browser, decoder: Page, m: Moment, preRollMs: number, still: boolean): Promise<Capture> {
  const page = await newSidePage(browser);
  await page.goto(FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate("paused = true");
  const box = await fitFrame(page);
  await takeOver(page);
  // The onset frame steps the scene by 0: rAF fires on the clock's 16 ms grid, and the real time
  // that leaks in before `pauseAt` puts the page's own `last` off that grid by a varying amount.
  await page.evaluate(`(() => {
    window.__parityOnsets = [];
    const sound = sfx;
    window.sfx = (k) => { window.__parityOnsets.push("sound:" + k); sound(k); };
    paused = true;
    ${DEPART_SCRIPT}
    ${still ? STILL_LIGHT : ""}
    ${m.mockupScript ?? ""}
    requestAnimationFrame(() => { paused = false; });
    start(CH.findIndex((c) => c.key === ${JSON.stringify(m.chapter ?? m.key)}));
  })()`);
  for (let rolled = 0; rolled < preRollMs; rolled += STEP_MS) await step(page);
  const own = { ...m, windowMs: m.mockupWindowMs ?? m.windowMs };
  const capture = await strip(page, box, decoder, own, preRollMs, (a) => (a.mockup ? page.evaluate(a.mockup) : undefined), async (_t, ms, acted) => ({
    t: 0,
    ...(await stepThen<Omit<TraceFrame, "t">>(page, ms, MOCKUP_SAMPLE, acted)),
  }), () => page.evaluate(MOCKUP_LAYOUT) as Promise<SideLayout>, async () => null);
  await expectDeparted(page);
  await page.context().close();
  return capture;
}

/** The frames traced from index `from` on: the trace grows every step, and carrying all of it out each time is quadratic. */
export const recorded = (page: Page, from = 0) =>
  page.evaluate((from) => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames.slice(from), from);

const TRACED_AT = (t: number) => `window.murlanTrace.frames.find((f) => Math.abs(f.t - ${t}) < ${STEP_MS / 2}) ?? null`;

export async function traced(page: Page, accept: (f: TraceFrame) => boolean, what: string): Promise<number> {
  let seen = 0;
  let t = -1;
  await stepUntil(
    page,
    async () => {
      const fresh = await recorded(page, seen);
      seen += fresh.length;
      return (t = fresh.find(accept)?.t ?? -1) >= 0;
    },
    what,
    { chunkMs: STEP_MS }
  );
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
  let seen = 0;
  let onset: number | undefined;
  for (;;) {
    const fresh = await recorded(page, seen);
    seen += fresh.length;
    if ((onset = fresh.find(isSkia)?.t) !== undefined) break;
    const waiting = await loading();
    if (Date.now() > deadline) throw new Error(`Skia never drew; still loading: ${waiting.join(", ") || "nothing"}`);
    if (waiting.length === 0) await step(page);
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(onset - mounted, "Skia's first frame, after the table's").toBeLessThanOrEqual(MAX_PRE_ROLL_MS);
  return onset;
}

async function openAppSide(browser: Browser, baseURL: string, m: Moment, variant: Variant) {
  const page = await newSidePage(browser, baseURL);
  const loading = trackLoads(page);
  // The app's only unswayed light is reduced motion's; at rest it snaps nothing the light was not already at.
  if (variant === "fallback" && m.fallbackStill) await page.emulateMedia({ reducedMotion: "reduce" });
  if (variant === "fallback") await page.route(CANVASKIT_ROUTE, () => undefined);
  // The CDN's own bytes (feltWeave.test.ts pins the version), without a download inside the measured run.
  else await page.route(CANVASKIT_ROUTE, (route) => route.fulfill({
    path: path.join(CANVASKIT_DIR, path.basename(new URL(route.request().url()).pathname)),
    headers: { "access-control-allow-origin": "*" },
  }));
  const started = Date.now();
  await m.appTrigger(page, baseURL);
  const mounted = await traced(page, m.appOnset, `the app's onset of ${m.key}`);
  const onset = variant === "skia" ? await skiaOnset(page, mounted, loading) : mounted;
  const preRollMs = Math.ceil((onset - mounted) / STEP_MS) * STEP_MS;  return { page, onset, preRollMs, onsetMs: Date.now() - started };
}

async function stripAppSide(side: Awaited<ReturnType<typeof openAppSide>>, decoder: Page, m: Moment, variant: Variant) {
  const { page, onset, preRollMs } = side;
  const capture = await strip(page, { x: 0, y: 0 }, decoder, m, preRollMs, (a) => a.app?.(page), (t, ms, acted) =>
    stepThen<TraceFrame | null>(page, t > preRollMs ? ms : null, TRACED_AT(onset + t - preRollMs), acted), async () => ({
    pile: await seatAnchor(page, "pile"),
    light: await settledLight(page, "bottom"),
    handTop: await page.evaluate(() =>
      Math.min(...[...document.querySelectorAll('[data-hand-state] [data-testid="card-box"]')].map((c) => c.getBoundingClientRect().top))
    ),
  }), () => appLayer(page));
  const felts = new Set(capture.trace.frames.map((f) => f.felt));
  expect([...felts], `the felt on screen through ${m.key}`).toEqual([variant]);
  await page.context().close();
  return capture;
}

const timed = async <T,>(work: Promise<T>): Promise<[T, number]> => {
  const started = Date.now();
  return [await work, Date.now() - started];
};

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
  const failures = [...diffParity(m, variant === "fallback", runs.mockup.trace, runs.app.trace, runs.app.layer), ...pillFailures];
  const moment = `${m.key}-${variant}`;
  const parity = { murlanParity: 1, moment, mode: m.mode, stepMs: STEP_MS, checkpoints: m.checkpoints, sides, failures };
  fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(parity));
  return parity;
}

/** Registers the parity test of one moment, in each of its variants or only in `only`. */
export function parityTests(key: string, only?: Variant) {
  const m = MOMENTS.find((x) => x.key === key);
  if (!m) throw new Error(`no parity moment ${key}`);
  for (const variant of (m.variants ?? (["skia", "fallback"] as const)).filter((v) => !only || v === only)) {
    test(`${m.key} with the ${variant} felt (${m.mode} mode)`, async ({ browser, baseURL }) => {
      test.setTimeout(15 * 60_000);
      const decoder = await browser.newPage();
      const opened = await openAppSide(browser, baseURL!, m, variant);
      const capture = async (side: SideName) =>
        side === "mockup"
          ? captureMockup(browser, decoder, m, opened.preRollMs, variant === "fallback" && !!m.fallbackStill)
          : stripAppSide(await openAppSide(browser, baseURL!, m, variant), decoder, m, variant);
      // Side by side once the app's onset fixes the pre-roll: each side steps its own virtual clock.
      const [[app, appMs], [mockup, mockupMs]] = await Promise.all([
        timed(stripAppSide(opened, decoder, m, variant)),
        timed(capture("mockup")),
      ]);
      const first = { mockup, app };
      const timing = `app onset ${opened.onsetMs} ms, then side by side: app ${appMs} ms, mockup ${mockupMs} ms`;
      test.info().annotations.push({ type: "parity timing", description: timing });
      process.stdout.write(`parity timing ${m.key}-${variant}: ${timing}\n`);

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
        const differing = again.frames.filter((f, i) => !f.jpeg.equals(first[side].frames[i].jpeg));
        for (const f of differing) {
          await test.info().attach(`${parity.moment}/replay/${side}-${String(f.t).padStart(5, "0")}.jpg`, { body: f.jpeg, contentType: "image/jpeg" });
        }
        expect.soft(differing.map((f) => f.t), `${side}: frames that did not replay byte for byte`).toEqual([]);
        expect.soft([...movingFields(first[side].trace)].sort(), `${side}: fields that move over the window`).toEqual(
          [...m.moves![side]].sort()
        );
      }
    });
  }
}
