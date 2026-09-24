// tests/e2e/mockupParity.spec.ts — the fidelity harness (#1255): the real table beside the
// Lantern Table mockup on one virtual clock. Each effect ticket under #1252 registers its moment
// in MOMENTS; `node scripts/mockupParityPage.mjs` builds the side-by-side page from the output.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { offlineGameSave } from "./helpers/offlineSeed";
import { installVirtualClock, takeOver, step, stepUntil } from "./helpers/virtualClock";
import { diffTraces, movingFields, STEP_MS, type Field, type Trace, type TraceFrame } from "./helpers/traceDiff";
import { regionBrightness, regionsFor, TABLE, type Seat } from "./helpers/parityRegions";
import { E2E_SUSPEND_AI_KEY, OFFLINE_SAVE_KEY, TUTORIAL_SEEN_KEY } from "../../lib/storageKeys";

const FIXTURE = pathToFileURL(path.resolve(__dirname, "fixtures", "lantern-table", "index.html")).href;
const DPR = 2;
const SEED = 1255;
const STRIP_STEPS = 2;

type SideName = "mockup" | "app";

interface Moment {
  /** The mockup's chapter key, `window.T.go`'s. */
  key: string;
  windowMs: number;
  checkpoints: number[];
  seatOnMove: Seat;
  /** Brings the app to the instant before its onset; the onset is the first traced frame `appOnset` accepts. */
  appTrigger: (page: Page, baseURL: string) => Promise<void>;
  appOnset: (frame: TraceFrame) => boolean;
  mode: "determinism" | "parity";
  /** Determinism mode: exactly the fields each side must move over the window; every other must hold still. */
  moves?: Record<SideName, Field[]>;
}

const heldTurnTable = async (page: Page, baseURL: string) => {
  await page.addInitScript(
    (entries) => {
      for (const [k, v] of entries) window.localStorage.setItem(k, v);
    },
    [
      [TUTORIAL_SEEN_KEY, "1"],
      [E2E_SUSPEND_AI_KEY, "1"],
      [OFFLINE_SAVE_KEY, JSON.stringify(offlineGameSave(4, 13, 0))],
    ]
  );
  await page.goto(baseURL);
  await takeOver(page);
  const resume = page.getByRole("button", { name: "Riprendi partita" });
  await stepUntil(page, () => resume.isVisible(), "the home screen");
  await page.evaluate(() => (window as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  await resume.click({ force: true });
};

const MOMENTS: Moment[] = [
  {
    key: "rest",
    windowMs: 2400,
    checkpoints: [0, 480, 960, 1440, 1920, 2400],
    seatOnMove: "you",
    appTrigger: heldTurnTable,
    appOnset: (f) => f.lamp !== null,
    mode: "determinism",
    moves: {
      mockup: ["lamp", "brightness"],
      app: ["onset", "lamp", "brightness"],
    },
  },
];

interface Capture {
  trace: Trace;
  frames: { t: number; jpeg: Buffer }[];
}

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
  };
})()`;

async function newSidePage(browser: Browser, baseURL?: string): Promise<Page> {
  const context = await browser.newContext({ viewport: TABLE, deviceScaleFactor: DPR, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await installVirtualClock(page, SEED);
  return page;
}

async function strip(page: Page, clip: { x: number; y: number }, decoder: Page, m: Moment, stepAfterOnset: () => Promise<TraceFrame | null>): Promise<Capture> {
  const frames: Capture["frames"] = [];
  const traced: TraceFrame[] = [];
  const regions: Trace["regions"] = [];
  const shape = regionsFor(m.seatOnMove);
  for (let k = 0; k * STEP_MS <= m.windowMs; k++) {
    const t = k * STEP_MS;
    const frame = await stepAfterOnset();
    if (frame) traced.push({ ...frame, t });
    if (k % STRIP_STEPS === 0) {
      const jpeg = await page.screenshot({ type: "jpeg", quality: 80, clip: { ...clip, ...TABLE } });
      frames.push({ t, jpeg });
      regions.push({ t, regions: await regionBrightness(decoder, jpeg, DPR, shape) });
    }
  }
  return { trace: { frames: traced, regions }, frames };
}

async function captureMockup(browser: Browser, decoder: Page, m: Moment): Promise<Capture> {
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
    requestAnimationFrame(() => { paused = false; });
    start(CH.findIndex((c) => c.key === ${JSON.stringify(m.key)}));
  })()`);
  const capture = await strip(page, box, decoder, m, async () => {
    await step(page);
    return { t: 0, ...((await page.evaluate(MOCKUP_SAMPLE)) as Omit<TraceFrame, "t">) };
  });
  await page.context().close();
  return capture;
}

async function captureApp(browser: Browser, baseURL: string, decoder: Page, m: Moment): Promise<Capture> {
  const page = await newSidePage(browser, baseURL);
  const recorded = () =>
    page.evaluate(() => (window as unknown as { murlanTrace: { frames: TraceFrame[] } }).murlanTrace.frames);
  await m.appTrigger(page, baseURL);
  let onset = 0;
  await stepUntil(
    page,
    async () => {
      onset = (await recorded()).find(m.appOnset)?.t ?? -1;
      return onset >= 0;
    },
    `the app's onset of ${m.key}`,
    { chunkMs: STEP_MS }
  );
  let t = onset - STEP_MS;
  const capture = await strip(page, { x: 0, y: 0 }, decoder, m, async () => {
    t += STEP_MS;
    if (t > onset) await step(page);
    return (await recorded()).find((f) => Math.abs(f.t - t) < STEP_MS / 2) ?? null;
  });
  await page.context().close();
  return capture;
}

function bundle(m: Moment, runs: Record<SideName, Capture>, dir: string) {
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
  const failures = diffTraces(runs.mockup.trace, runs.app.trace, m.checkpoints);
  const parity = { murlanParity: 1, moment: m.key, mode: m.mode, stepMs: STEP_MS, checkpoints: m.checkpoints, sides, failures };
  fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(parity));
  return parity;
}

test.describe("mockup parity", () => {
  for (const m of MOMENTS) {
    test(`${m.key} (${m.mode} mode)`, async ({ browser, baseURL }) => {
      test.setTimeout(15 * 60_000);
      const decoder = await browser.newPage();
      const capture = (side: SideName) =>
        side === "mockup" ? captureMockup(browser, decoder, m) : captureApp(browser, baseURL!, decoder, m);
      const first = { mockup: await capture("mockup"), app: await capture("app") };

      const dir = test.info().outputPath(m.key);
      const parity = bundle(m, first, dir);
      await test.info().attach(`${m.key}/parity.json`, { path: path.join(dir, "parity.json"), contentType: "application/json" });
      for (const side of ["mockup", "app"] as const) {
        for (const f of parity.sides[side].frames) {
          await test.info().attach(`${m.key}/${f.file}`, { path: path.join(dir, f.file), contentType: "image/jpeg" });
        }
      }

      if (m.mode === "parity") {
        expect(parity.failures, "the app's trace against the mockup's").toEqual([]);
        return;
      }
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
});
